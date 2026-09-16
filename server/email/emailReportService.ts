import { getPostgresPool } from '../../db';
import { calculateEmailReport, type ReportEmail, type ReportPeriod } from './emailReporting';
import { emailWorkingMinutesBetween } from '../../shared/emailBusinessHours';
import * as XLSX from 'xlsx';

export interface OwnedReportEmail extends ReportEmail {
  subject: string; customerEmail: string;
  receiptOwner: string | null; responseOwner: string | null; resolutionOwner: string | null;
  cutoffOwner: string | null;
}
type Owner = { email: string; name: string };

// Assignment history is append-only. The first entry applies from receipt (sync may be delayed).
export const reportRowsSql = `SELECT t.*,
  initial.email AS receipt_owner,
  response_owner.email AS response_owner, resolution_owner.email AS resolution_owner,
  cutoff_owner.email AS cutoff_owner
FROM email_threads t
LEFT JOIN LATERAL (SELECT m.email FROM email_assignment_history h
  LEFT JOIN email_team_members m ON m.id=h.new_member_id
  WHERE h.email_thread_id=t.id ORDER BY h.changed_at,h.id LIMIT 1) initial ON true
LEFT JOIN LATERAL (SELECT m.email FROM email_assignment_history h
  LEFT JOIN email_team_members m ON m.id=h.new_member_id WHERE h.email_thread_id=t.id
  ORDER BY (h.changed_at <= LEAST(COALESCE(t.first_response_at,$2),$2)) DESC,
    CASE WHEN h.changed_at <= LEAST(COALESCE(t.first_response_at,$2),$2) THEN h.changed_at END DESC,
    CASE WHEN h.changed_at <= LEAST(COALESCE(t.first_response_at,$2),$2) THEN h.id END DESC,
    h.changed_at,h.id LIMIT 1) response_owner ON true
LEFT JOIN LATERAL (SELECT m.email FROM email_assignment_history h
  LEFT JOIN email_team_members m ON m.id=h.new_member_id WHERE h.email_thread_id=t.id
  ORDER BY (h.changed_at <= LEAST(COALESCE(t.resolved_at,$2),$2)) DESC,
    CASE WHEN h.changed_at <= LEAST(COALESCE(t.resolved_at,$2),$2) THEN h.changed_at END DESC,
    CASE WHEN h.changed_at <= LEAST(COALESCE(t.resolved_at,$2),$2) THEN h.id END DESC,
    h.changed_at,h.id LIMIT 1) resolution_owner ON true
LEFT JOIN LATERAL (SELECT m.email FROM email_assignment_history h
  LEFT JOIN email_team_members m ON m.id=h.new_member_id WHERE h.email_thread_id=t.id
  ORDER BY (h.changed_at < $2) DESC,
    CASE WHEN h.changed_at < $2 THEN h.changed_at END DESC,
    CASE WHEN h.changed_at < $2 THEN h.id END DESC,h.changed_at,h.id LIMIT 1) cutoff_owner ON true
WHERE t.received_at < $2 AND (t.received_at >= $1 OR t.resolved_at IS NULL OR t.resolved_at >= $1)`;

export function assembleEmailReport(emails: OwnedReportEmail[], owners: Owner[], period: ReportPeriod, now: Date, owner?: string) {
  const cutoff = new Date(Math.min(now.getTime(), period.endExclusive.getTime()));
  const scope = (field: keyof OwnedReportEmail, selected?: string) => selected ? emails.filter(e => e[field] === selected) : emails;
  const summarize = (selected?: string) => {
    const workload = calculateEmailReport(scope('receiptOwner', selected), period, now);
    return { ...workload,
      response: calculateEmailReport(scope('responseOwner', selected), period, now).response,
      resolution: calculateEmailReport(scope('resolutionOwner', selected), period, now).resolution,
      openingBacklog: calculateEmailReport(scope('cutoffOwner', selected), period, now).openingBacklog,
      olderBacklogStillOpen: calculateEmailReport(scope('cutoffOwner', selected), period, now).olderBacklogStillOpen };
  };
  const rows = emails.flatMap(e => (['response', 'resolution'] as const).flatMap(stage => {
    const at = stage === 'response' ? e.firstResponseAt : e.resolvedAt;
    const due = stage === 'response' ? e.responseDueAt : e.resolutionDueAt;
    const assigned = stage === 'response' ? e.responseOwner : e.resolutionOwner;
    if ((owner && assigned !== owner) || (at && at < cutoff) || due >= cutoff) return [];
    return [{ id: e.id, subject: e.subject, customerEmail: e.customerEmail,
      owner: assigned ? owners.find(m => m.email === assigned)?.name || assigned : 'Unknown / unassigned',
      stage, receivedAt: e.receivedAt.toISOString(), dueAt: due.toISOString(),
      overdueWorkingMinutes: emailWorkingMinutesBetween(due, cutoff, e.holidayDates),
      olderBacklog: e.receivedAt < period.start }];
  })).sort((a,b) => b.overdueWorkingMinutes-a.overdueWorkingMinutes || a.id-b.id);
  const selectedOwners = owner ? owners.filter(m => m.email === owner) : owners;
  const unknown = emails.some(e => !e.receiptOwner || !e.responseOwner || !e.resolutionOwner);
  return { period: { start: period.start.toISOString(), endExclusive: period.endExclusive.toISOString() },
    summary: summarize(owner), owners: selectedOwners.map(m => ({ ...m, ...summarize(m.email) })),
    unknownOwnership: !owner && unknown,
    overdue: rows,
    attribution: 'Received workload: initial owner. Response/resolution SLA: owner at completion, or at period cutoff if still open. Backlog: owner at cutoff. Missing history is included in team totals only.' };
}

export async function getEmailReport(period: ReportPeriod, now: Date, owner?: string) {
  const cutoff = new Date(Math.min(now.getTime(), period.endExclusive.getTime()));
  const pool = getPostgresPool();
  const [rows, members] = await Promise.all([
    pool.query(reportRowsSql, [period.start, cutoff]),
    pool.query('SELECT email,display_name AS name FROM email_team_members ORDER BY display_name'),
  ]);
  const emails: OwnedReportEmail[] = rows.rows.map(r => ({
    id: Number(r.id), subject: r.subject || '(no subject)', customerEmail: r.customer_email,
    receivedAt: new Date(r.received_at), firstResponseAt: r.first_response_at ? new Date(r.first_response_at) : null,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
    responseDueAt: new Date(r.response_due_at), resolutionDueAt: new Date(r.resolution_due_at),
    holidayDates: r.sla_settings_snapshot?.holidayDates || [],
    receiptOwner: r.receipt_owner, responseOwner: r.response_owner,
    resolutionOwner: r.resolution_owner, cutoffOwner: r.cutoff_owner,
  }));
  return assembleEmailReport(emails, members.rows, period, now, owner);
}

export type EmailReport = ReturnType<typeof assembleEmailReport>;
export function emailReportWorkbook(report: EmailReport): Buffer {
  const book = XLSX.utils.book_new();
  function sheet(name: string, rows: unknown[][], widths: number[]) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(wch => ({ wch }));
    if (rows.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:rows[0].length-1}}) };
    XLSX.utils.book_append_sheet(book, ws, name);
  }
  const s = report.summary;
  sheet('Summary', [['Metric','Value'], ['Period start (UTC)',report.period.start],['Period end exclusive (UTC)',report.period.endExclusive],['As of (UTC)',s.asOf],
    ['Received',s.received],['Opening backlog',s.openingBacklog],['Older backlog still open',s.olderBacklogStillOpen],
    ...(['response','resolution'] as const).flatMap(stage => Object.entries(s[stage]).map(([k,v]) => [`${stage}: ${k}`,v])),
    ['Attribution',report.attribution]], [36,100]);
  sheet('Owners', [['Owner','Email','Received','Response met','Response completed late','Response overdue open','Response SLA %','Resolution met','Resolution completed late','Resolution overdue open','Resolution SLA %','Older backlog'],
    ...report.owners.map(o => [o.name,o.email,o.received,o.response.met,o.response.completedLate,o.response.overdueOpen,o.response.compliancePercent,
      o.resolution.met,o.resolution.completedLate,o.resolution.overdueOpen,o.resolution.compliancePercent,o.olderBacklogStillOpen])], [24,32,12,16,22,22,18,16,22,22,18,18]);
  sheet('Overdue', [['Thread','Subject','Customer','Owner','Stage','Received (UTC)','Due (UTC)','Overdue working minutes','Older backlog'],
    ...report.overdue.map(r => [r.id,r.subject,r.customerEmail,r.owner,r.stage,r.receivedAt,r.dueAt,r.overdueWorkingMinutes,r.olderBacklog])], [12,60,32,24,16,26,26,26,18]);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
