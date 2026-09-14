import type pg from 'pg';
import { getPostgresPool } from '../../db';
import type { GraphMessage } from './graphClient';
import { emailIdentity, isAddressedToGroup, replyMatchesKnownMessage } from './messageIdentity';
import { chooseEmailOwner } from './emailAssignmentService';
import { dueEmailAlerts, recordFirstResponse, startEmailSla, validateEmailSlaSettings } from './emailSlaService';
import type { EmailAlertType, EmailSlaSettings, EmailSlaState } from './emailTypes';
import { emailWorkingMinutesBetween, isEmailWorkingTime } from '../../shared/emailBusinessHours';
import { resolveEmailThreadSql } from './emailResolution';

type Client = pg.PoolClient;
type SqlRow = Record<string, any>;

async function transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function address(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function recipients(message: GraphMessage): string[] {
  return [...(message.toRecipients || []), ...(message.ccRecipients || [])]
    .map((item) => address(item.emailAddress?.address)).filter(Boolean);
}

export async function getEmailSettings(): Promise<EmailSlaSettings> {
  const result = await getPostgresPool().query<SqlRow>('SELECT * FROM email_sla_settings WHERE id = 1');
  const row = result.rows[0];
  if (!row) throw new Error('Email SLA settings are missing; run migration 009');
  const settings = {
    responseMinutes: row.response_minutes,
    responseWarningMinutes: row.response_warning_minutes,
    responseUrgentMinutes: row.response_urgent_minutes,
    resolutionMinutes: row.resolution_minutes,
    resolutionWarningMinutes: row.resolution_warning_minutes,
    resolutionUrgentMinutes: row.resolution_urgent_minutes,
    holidayDates: row.holiday_dates,
  };
  validateEmailSlaSettings(settings);
  return settings;
}

export async function setEmailSettings(settings: EmailSlaSettings): Promise<void> {
  validateEmailSlaSettings(settings);
  await getPostgresPool().query(
    `UPDATE email_sla_settings SET response_minutes=$1, response_warning_minutes=$2,
     response_urgent_minutes=$3, resolution_minutes=$4, resolution_warning_minutes=$5,
     resolution_urgent_minutes=$6, holiday_dates=$7::jsonb, updated_at=now() WHERE id=1`,
    [settings.responseMinutes, settings.responseWarningMinutes, settings.responseUrgentMinutes,
      settings.resolutionMinutes, settings.resolutionWarningMinutes, settings.resolutionUrgentMinutes,
      JSON.stringify(settings.holidayDates)],
  );
}

export async function ensureEmailTeam(mailboxes: readonly string[]): Promise<void> {
  await transaction(async (client) => {
    for (const mailbox of mailboxes) {
      await client.query(
        `INSERT INTO email_team_members (email, display_name) VALUES ($1,$2)
         ON CONFLICT (email) DO NOTHING`,
        [mailbox.toLowerCase(), mailbox.split('@')[0]],
      );
    }
  });
}

async function assignOwner(client: Client, groupAddress: string, message: GraphMessage): Promise<{ memberId: number | null; method: string | null }> {
  await client.query('INSERT INTO email_assignment_cursor (mailbox) VALUES ($1) ON CONFLICT DO NOTHING', [groupAddress]);
  const cursor = await client.query<SqlRow>('SELECT last_member_id FROM email_assignment_cursor WHERE mailbox=$1 FOR UPDATE', [groupAddress]);
  const members = await client.query<SqlRow>(
    `SELECT id, email, is_available, round_robin_enabled, is_monitored FROM email_team_members ORDER BY id`,
  );
  const rules = await client.query<SqlRow>(
    `SELECT priority, match_field, match_value, assigned_member_id, enabled FROM email_assignment_rules ORDER BY priority,id`,
  );
  const directRecipients = recipients(message).filter((email) =>
    email !== groupAddress && members.rows.some((member) => member.email === email));
  const decision = chooseEmailOwner({
    senderEmail: address(message.from?.emailAddress?.address),
    recipientEmails: recipients(message),
    directOwnerEmail: directRecipients.length === 1 ? directRecipients[0] : null,
    previousRoundRobinMemberId: cursor.rows[0]?.last_member_id,
  }, members.rows.map((row) => ({
    memberId: Number(row.id), email: row.email, available: row.is_available,
    roundRobinEnabled: row.round_robin_enabled, monitored: row.is_monitored,
  })), rules.rows.map((row) => ({
    priority: row.priority, field: row.match_field, value: row.match_value,
    memberId: Number(row.assigned_member_id), enabled: row.enabled,
  })));
  if (decision.method === 'ROUND_ROBIN') {
    await client.query('UPDATE email_assignment_cursor SET last_member_id=$2, updated_at=now() WHERE mailbox=$1',
      [groupAddress, decision.memberId]);
  }
  return decision;
}

export async function storeInbound(
  sourceMailbox: string,
  groupAddress: string,
  message: GraphMessage,
  settings: EmailSlaSettings,
  monitoringStart: Date,
): Promise<number | null> {
  if (message['@removed'] || !isAddressedToGroup(message, groupAddress)) return null;
  const internetId = emailIdentity(message).internetMessageId;
  const receivedAt = new Date(message.receivedDateTime || '');
  const sender = address(message.from?.emailAddress?.address);
  if (!internetId || !sender || Number.isNaN(receivedAt.getTime()) || receivedAt < monitoringStart) return null;
  const sla = startEmailSla(receivedAt, settings);
  return transaction(async (client) => {
    const existing = await client.query<SqlRow>('SELECT email_thread_id FROM email_messages WHERE internet_message_id=$1', [internetId]);
    if (existing.rows[0]) return Number(existing.rows[0].email_thread_id);
    const identity = emailIdentity(message);
    const referenced = [identity.inReplyTo, ...identity.references].filter((value): value is string => Boolean(value));
    if (referenced.length) {
      const prior = await client.query<SqlRow>(
        `SELECT email_thread_id FROM email_messages WHERE internet_message_id=ANY($1::text[])
         ORDER BY sent_or_received_at DESC LIMIT 1`, [referenced],
      );
      if (prior.rows[0]) {
        const priorThreadId = Number(prior.rows[0].email_thread_id);
        await client.query(
          `INSERT INTO email_messages (email_thread_id,graph_message_id,internet_message_id,graph_conversation_id,
           source_mailbox,sender_email,recipient_data,direction,sent_or_received_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'INBOUND',$8) ON CONFLICT DO NOTHING`,
          [priorThreadId, message.id, internetId, message.conversationId || null, sourceMailbox, sender,
            JSON.stringify(recipients(message)), receivedAt],
        );
        return priorThreadId;
      }
    }
    const assignment = await assignOwner(client, groupAddress, message);
    const thread = await client.query<SqlRow>(
      `INSERT INTO email_threads (mailbox,graph_conversation_id,root_internet_message_id,subject,customer_email,
       assigned_member_id,assignment_method,received_at,response_due_at,resolution_due_at,status,sla_settings_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (root_internet_message_id) DO NOTHING RETURNING id`,
      [groupAddress, message.conversationId || null, internetId, message.subject || '', sender,
        assignment.memberId, assignment.method, sla.receivedAt, sla.responseDueAt, sla.resolutionDueAt,
        assignment.memberId ? 'AWAITING_RESPONSE' : 'UNASSIGNED', JSON.stringify(settings)],
    );
    const threadId = Number(thread.rows[0]?.id || (await client.query<SqlRow>(
      'SELECT id FROM email_threads WHERE root_internet_message_id=$1', [internetId])).rows[0]?.id);
    await client.query(
      `INSERT INTO email_messages (email_thread_id,graph_message_id,internet_message_id,graph_conversation_id,
       source_mailbox,sender_email,recipient_data,direction,sent_or_received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'INBOUND',$8)
       ON CONFLICT DO NOTHING`,
      [threadId, message.id, internetId, message.conversationId || null, sourceMailbox, sender,
        JSON.stringify(recipients(message)), receivedAt],
    );
    if (thread.rows[0] && assignment.memberId) {
      const history = await client.query<SqlRow>(
        `INSERT INTO email_assignment_history (email_thread_id,new_member_id,method,changed_by)
         VALUES ($1,$2,$3,'system') RETURNING id`, [threadId, assignment.memberId, assignment.method],
      );
      await client.query(
        `INSERT INTO email_assignment_notifications (email_thread_id,member_id,assignment_history_id)
         VALUES ($1,$2,$3)`, [threadId, assignment.memberId, history.rows[0].id],
      );
    }
    return threadId;
  });
}

export async function storeOutbound(sourceMailbox: string, message: GraphMessage): Promise<number | null> {
  if (message['@removed']) return null;
  const identity = emailIdentity(message);
  const sentAt = new Date(message.sentDateTime || '');
  if (!identity.internetMessageId || Number.isNaN(sentAt.getTime())) return null;
  const referenced = [identity.inReplyTo, ...identity.references].filter((value): value is string => Boolean(value));
  if (!referenced.length) return null;
  return transaction(async (client) => {
    const known = await client.query<SqlRow>(
      `SELECT internet_message_id,email_thread_id FROM email_messages WHERE internet_message_id = ANY($1::text[])
       ORDER BY sent_or_received_at DESC LIMIT 1`, [referenced],
    );
    if (!known.rows[0] || !replyMatchesKnownMessage(message, new Set(known.rows.map((row) => row.internet_message_id)))) return null;
    const threadId = Number(known.rows[0].email_thread_id);
    const insert = await client.query<SqlRow>(
      `INSERT INTO email_messages (email_thread_id,graph_message_id,internet_message_id,graph_conversation_id,
       source_mailbox,sender_email,recipient_data,direction,sent_or_received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'OUTBOUND',$8) ON CONFLICT DO NOTHING RETURNING id`,
      [threadId, message.id, identity.internetMessageId, message.conversationId || null, sourceMailbox,
        address(message.from?.emailAddress?.address), JSON.stringify(recipients(message)), sentAt],
    );
    if (!insert.rowCount) return threadId;
    const row = (await client.query<SqlRow>('SELECT * FROM email_threads WHERE id=$1 FOR UPDATE', [threadId])).rows[0];
    if (!row || sentAt < new Date(row.received_at) || row.first_response_at) return threadId;
    const state = recordFirstResponse({
      receivedAt: new Date(row.received_at), responseDueAt: new Date(row.response_due_at),
      resolutionDueAt: new Date(row.resolution_due_at), firstResponseAt: null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      responseBreached: row.response_breached, resolutionBreached: row.resolution_breached,
    }, sentAt);
    await client.query(
      `UPDATE email_threads SET first_response_at=$2,response_breached=$3,
       status=CASE WHEN status='RESOLVED' THEN status ELSE 'IN_PROGRESS' END,updated_at=now() WHERE id=$1`,
      [threadId, state.firstResponseAt, state.responseBreached],
    );
    return threadId;
  });
}

export async function getDeltaLink(mailbox: string, folder: string): Promise<string | undefined> {
  const row = (await getPostgresPool().query<SqlRow>(
    'SELECT delta_link FROM email_sync_state WHERE mailbox=$1 AND folder=$2', [mailbox, folder],
  )).rows[0];
  return row?.delta_link || undefined;
}

export async function saveDeltaLink(mailbox: string, folder: string, deltaLink: string): Promise<void> {
  await getPostgresPool().query(
    `INSERT INTO email_sync_state (mailbox,folder,delta_link,last_successful_sync_at,updated_at)
     VALUES ($1,$2,$3,now(),now()) ON CONFLICT (mailbox,folder) DO UPDATE SET
     delta_link=EXCLUDED.delta_link,last_successful_sync_at=now(),last_error_code=NULL,updated_at=now()`,
    [mailbox, folder, deltaLink],
  );
}

export async function recordSyncFailure(mailbox: string, folder: string, code: string): Promise<void> {
  await getPostgresPool().query(
    `INSERT INTO email_sync_state (mailbox,folder,last_error_at,last_error_code)
     VALUES ($1,$2,now(),$3) ON CONFLICT (mailbox,folder) DO UPDATE SET
     last_error_at=now(),last_error_code=$3,updated_at=now()`, [mailbox, folder, code.slice(0, 100)],
  );
}

export async function recordOptionalFolderAbsent(mailbox: string): Promise<void> {
  await getPostgresPool().query(
    `INSERT INTO email_sync_state (mailbox,folder,last_error_code,updated_at)
     VALUES ($1,'team','OPTIONAL_FOLDER_NOT_PRESENT',now()) ON CONFLICT (mailbox,folder) DO UPDATE SET
     last_error_code='OPTIONAL_FOLDER_NOT_PRESENT',updated_at=now()`, [mailbox],
  );
}

export async function listEmailThreads(filter: string, ownerEmail?: string): Promise<SqlRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter === 'unassigned') conditions.push("t.status='UNASSIGNED'");
  else if (filter === 'awaiting') conditions.push("t.status='AWAITING_RESPONSE'");
  else if (filter === 'in-progress') conditions.push("t.status='IN_PROGRESS'");
  else if (filter === 'resolved') conditions.push("t.status='RESOLVED'");
  else if (filter === 'breached') conditions.push('(t.response_breached OR t.resolution_breached OR (t.first_response_at IS NULL AND t.response_due_at < now()) OR (t.resolved_at IS NULL AND t.resolution_due_at < now()))');
  if (ownerEmail) {
    params.push(ownerEmail.toLowerCase());
    conditions.push(`m.email=$${params.length}`);
  }
  return (await getPostgresPool().query<SqlRow>(
    `SELECT t.id,t.subject,t.customer_email,t.received_at,t.first_response_at,t.resolved_at,
      t.response_due_at,t.resolution_due_at,t.status,t.response_breached,t.resolution_breached,
      t.assignment_method,t.sla_settings_snapshot,t.resolved_by,t.resolution_note,
      m.email AS owner_email,m.display_name AS owner_name
     FROM email_threads t LEFT JOIN email_team_members m ON m.id=t.assigned_member_id
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY t.received_at DESC LIMIT 200`, params,
  )).rows;
}

export async function assignEmailThread(threadId: number, memberId: number): Promise<boolean> {
  return transaction(async (client) => {
    const member = (await client.query<SqlRow>(
      'SELECT id FROM email_team_members WHERE id=$1 AND is_monitored=true', [memberId],
    )).rows[0];
    if (!member) return false;
    const row = (await client.query<SqlRow>(
      'SELECT assigned_member_id,status FROM email_threads WHERE id=$1 FOR UPDATE', [threadId],
    )).rows[0];
    if (!row) return false;
    await client.query(
      `UPDATE email_threads SET assigned_member_id=$2,assignment_method='MANUAL',
       status=CASE WHEN status='UNASSIGNED' THEN 'AWAITING_RESPONSE' ELSE status END,
       updated_at=now() WHERE id=$1`, [threadId, memberId],
    );
    const history = await client.query<SqlRow>(
      `INSERT INTO email_assignment_history (email_thread_id,previous_member_id,new_member_id,method,changed_by)
       VALUES ($1,$2,$3,'MANUAL','admin') RETURNING id`, [threadId, row.assigned_member_id, memberId],
    );
    if (Number(row.assigned_member_id) !== memberId) {
      await client.query(
        `INSERT INTO email_assignment_notifications (email_thread_id,member_id,assignment_history_id)
         VALUES ($1,$2,$3)`, [threadId, memberId, history.rows[0].id],
      );
    }
    return true;
  });
}

export async function resolveEmailThread(threadId: number, actor: string, ownerEmail: string | null, note: string | null): Promise<boolean> {
  const result = await getPostgresPool().query(
    resolveEmailThreadSql, [threadId, ownerEmail, actor, note],
  );
  return Boolean(result.rowCount);
}

export async function emitDueAlerts(settings: EmailSlaSettings): Promise<number> {
  const rows = (await getPostgresPool().query<SqlRow>(
    `SELECT * FROM email_threads WHERE received_at > now()-interval '30 days' AND
     (resolved_at IS NULL OR response_breached OR resolution_breached)`,
  )).rows;
  let count = 0;
  for (const row of rows) {
    const state: EmailSlaState = {
      receivedAt: new Date(row.received_at), responseDueAt: new Date(row.response_due_at),
      resolutionDueAt: new Date(row.resolution_due_at),
      firstResponseAt: row.first_response_at ? new Date(row.first_response_at) : null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      responseBreached: row.response_breached, resolutionBreached: row.resolution_breached,
    };
    const snapshot: EmailSlaSettings = row.sla_settings_snapshot || settings;
    const due = dueEmailAlerts(state, snapshot, new Date(), new Set<EmailAlertType>(),
      row.status === 'UNASSIGNED');
    for (const alert of due) {
      const result = await getPostgresPool().query(
        `INSERT INTO email_alerts (email_thread_id,alert_type) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [row.id, alert],
      );
      count += result.rowCount || 0;
    }
  }
  return count;
}

export async function listEmailAlerts(ownerEmail?: string): Promise<SqlRow[]> {
  return (await getPostgresPool().query<SqlRow>(
    `SELECT a.id,a.email_thread_id,a.alert_type,a.emitted_at,t.subject,t.customer_email,m.display_name AS owner_name
     FROM email_alerts a JOIN email_threads t ON t.id=a.email_thread_id
     LEFT JOIN email_team_members m ON m.id=t.assigned_member_id
     WHERE a.acknowledged_at IS NULL ${ownerEmail ? 'AND m.email=$1' : ''}
     ORDER BY a.emitted_at DESC LIMIT 100`, ownerEmail ? [ownerEmail.toLowerCase()] : [],
  )).rows;
}

export async function acknowledgeEmailAlert(alertId: number, ownerEmail?: string): Promise<boolean> {
  const result = await getPostgresPool().query(
    `UPDATE email_alerts a SET acknowledged_at=now()
     FROM email_threads t LEFT JOIN email_team_members m ON m.id=t.assigned_member_id
     WHERE a.id=$1 AND a.email_thread_id=t.id AND a.acknowledged_at IS NULL
     ${ownerEmail ? 'AND m.email=$2' : ''}`,
    ownerEmail ? [alertId, ownerEmail.toLowerCase()] : [alertId],
  );
  return Boolean(result.rowCount);
}

export async function listEmailTeam(): Promise<SqlRow[]> {
  return (await getPostgresPool().query<SqlRow>(
    `SELECT id,email,display_name,is_available,round_robin_enabled,is_monitored
     FROM email_team_members ORDER BY display_name`,
  )).rows;
}

export async function updateEmailMember(memberId: number, values: { isAvailable?: boolean; roundRobinEnabled?: boolean; displayName?: string }): Promise<boolean> {
  const result = await getPostgresPool().query(
    `UPDATE email_team_members SET is_available=COALESCE($2,is_available),
     round_robin_enabled=COALESCE($3,round_robin_enabled),
     display_name=COALESCE($4,display_name),updated_at=now() WHERE id=$1`,
    [memberId, values.isAvailable ?? null, values.roundRobinEnabled ?? null, values.displayName ?? null],
  );
  return Boolean(result.rowCount);
}

export async function emailHealth(): Promise<SqlRow[]> {
  return (await getPostgresPool().query<SqlRow>(
    `SELECT mailbox,folder,last_successful_sync_at,last_error_at,last_error_code,subscription_expires_at
     FROM email_sync_state ORDER BY mailbox,folder`,
  )).rows;
}

export async function emailSummary(ownerEmail?: string): Promise<SqlRow> {
  const settings = await getEmailSettings();
  const now = new Date();
  const row = (await getPostgresPool().query<SqlRow>(
    `SELECT COUNT(*)::int AS total_received,
      COUNT(*) FILTER (WHERE status='UNASSIGNED')::int AS unassigned,
      COUNT(*) FILTER (WHERE status='AWAITING_RESPONSE')::int AS awaiting_response,
      COUNT(*) FILTER (WHERE status='IN_PROGRESS')::int AS in_progress,
      COUNT(*) FILTER (WHERE status='RESOLVED' AND resolved_at::date=current_date)::int AS resolved_today,
      COUNT(*) FILTER (WHERE response_breached OR resolution_breached OR
        (first_response_at IS NULL AND response_due_at <= now()) OR
        (resolved_at IS NULL AND resolution_due_at <= now()))::int AS breached,
      COUNT(*) FILTER (WHERE first_response_at IS NOT NULL AND response_breached=false)::int AS response_met,
      COUNT(*) FILTER (WHERE first_response_at IS NOT NULL)::int AS responded,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolution_breached=false)::int AS resolution_met,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved
     FROM email_threads t LEFT JOIN email_team_members m ON m.id=t.assigned_member_id
     CROSS JOIN email_sla_settings s
     WHERE s.id=1 AND t.received_at > now()-interval '30 days'
     ${ownerEmail ? 'AND m.email=$1' : ''}`, ownerEmail ? [ownerEmail.toLowerCase()] : [],
  )).rows[0];
  row.near_sla = 0;
  {
    const open = (await getPostgresPool().query<SqlRow>(
      `SELECT t.first_response_at,t.resolved_at,t.response_due_at,t.resolution_due_at,t.sla_settings_snapshot
       FROM email_threads t LEFT JOIN email_team_members m ON m.id=t.assigned_member_id
       WHERE t.received_at > now()-interval '30 days' AND (t.first_response_at IS NULL OR t.resolved_at IS NULL)
       ${ownerEmail ? 'AND m.email=$1' : ''}`,
      ownerEmail ? [ownerEmail.toLowerCase()] : [],
    )).rows;
    row.near_sla = open.filter((thread) => {
      const responseDue = new Date(thread.response_due_at);
      const resolutionDue = new Date(thread.resolution_due_at);
      const snapshot: EmailSlaSettings = thread.sla_settings_snapshot || settings;
      if (!isEmailWorkingTime(now, snapshot.holidayDates)) return false;
      return (!thread.first_response_at && responseDue > now &&
        emailWorkingMinutesBetween(now, responseDue, snapshot.holidayDates) <=
          snapshot.responseMinutes - snapshot.responseWarningMinutes) ||
        (!thread.resolved_at && resolutionDue > now &&
          emailWorkingMinutesBetween(now, resolutionDue, snapshot.holidayDates) <=
          snapshot.resolutionMinutes - snapshot.resolutionWarningMinutes);
    }).length;
  }
  return row;
}

export async function listAssignmentNotifications(ownerEmail: string): Promise<SqlRow[]> {
  return (await getPostgresPool().query<SqlRow>(
    `SELECT n.id,n.email_thread_id,n.created_at,t.subject,t.customer_email,h.method
     FROM email_assignment_notifications n
     JOIN email_team_members m ON m.id=n.member_id
     JOIN email_threads t ON t.id=n.email_thread_id
     JOIN email_assignment_history h ON h.id=n.assignment_history_id
     WHERE m.email=$1 AND n.seen_at IS NULL AND t.assigned_member_id=n.member_id
     ORDER BY n.created_at DESC LIMIT 50`, [ownerEmail.toLowerCase()],
  )).rows;
}

export async function markAssignmentNotificationSeen(id: number, ownerEmail: string): Promise<boolean> {
  const result = await getPostgresPool().query(
    `UPDATE email_assignment_notifications n SET seen_at=now()
     FROM email_team_members m WHERE n.id=$1 AND n.member_id=m.id AND m.email=$2 AND n.seen_at IS NULL`,
    [id, ownerEmail.toLowerCase()],
  );
  return Boolean(result.rowCount);
}
