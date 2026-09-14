import { getPostgresPool } from '../../db';
import { GraphClient, type GraphMessage } from './graphClient';
import { emailIdentity, isAddressedToGroup } from './messageIdentity';
import {
  emailHealth, emitDueAlerts, ensureEmailTeam, getDeltaLink, getEmailSettings,
  recordOptionalFolderAbsent, recordSyncFailure, saveDeltaLink, storeInbound, storeOutbound,
} from './emailRepository';

export interface EmailRuntimeConfig {
  groupAddress: string;
  mailboxes: readonly string[];
  monitoringStart: Date;
  graph: GraphClient;
}

function parseMailboxList(value: string): string[] {
  return value.split(',').map((mailbox) => mailbox.trim().toLowerCase()).filter(Boolean);
}

export function configuredEmailRuntime(): EmailRuntimeConfig | null {
  if (process.env.EMAIL_SLA_ENABLED !== 'true') return null;
  const groupAddress = (process.env.MICROSOFT_CS_GROUP_ADDRESS || '').trim().toLowerCase();
  const mailboxes = parseMailboxList(process.env.MICROSOFT_MONITORED_MAILBOXES || '');
  const monitoringStart = new Date(process.env.EMAIL_SLA_START_AT || '');
  if (!groupAddress || !mailboxes.length || Number.isNaN(monitoringStart.getTime())) {
    throw new Error('Email SLA needs a CS group address, explicit mailbox allowlist, and EMAIL_SLA_START_AT');
  }
  return {
    groupAddress, mailboxes, monitoringStart,
    graph: new GraphClient({
      tenantId: process.env.MICROSOFT_TENANT_ID || '',
      clientId: process.env.MICROSOFT_CLIENT_ID || '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
      mailboxes,
    }),
  };
}

async function syncFolder(config: EmailRuntimeConfig, mailbox: string, folder: string, direction: 'inbox' | 'sentitems'): Promise<number> {
  let link = await getDeltaLink(mailbox, folder);
  let processed = 0;
  const settings = await getEmailSettings();
  for (let pageNumber = 0; pageNumber < 25; pageNumber++) {
    const page = await config.graph.getDeltaPage(mailbox, folder, link);
    for (const item of page.value) {
      if (item['@removed']) continue;
      // Delta's first pass can include years of unrelated personal mail.
      // Do not request headers or create SLA records before the approved start.
      const eventAt = new Date((direction === 'inbox' ? item.receivedDateTime : item.sentDateTime) || '');
      if (Number.isNaN(eventAt.getTime()) || eventAt < config.monitoringStart) continue;
      if (direction === 'inbox') {
        if (!isAddressedToGroup(item, config.groupAddress)) continue;
        const sender = item.from?.emailAddress?.address?.trim().toLowerCase();
        if (sender && config.mailboxes.includes(sender)) continue;
        // Headers identify customer follow-ups. Only request them for messages
        // addressed to CS; full bodies and attachments are never retrieved.
        const detail = await config.graph.getMessageHeaders(mailbox, item.id);
        const message: GraphMessage = { ...item, internetMessageHeaders: detail.internetMessageHeaders };
        if (!emailIdentity(message).internetMessageId) continue;
        if (await storeInbound(mailbox, config.groupAddress, message, settings, config.monitoringStart)) processed++;
      } else {
        const detail = await config.graph.getMessageHeaders(mailbox, item.id);
        const message: GraphMessage = { ...item, internetMessageHeaders: detail.internetMessageHeaders };
        if (await storeOutbound(mailbox, message)) processed++;
      }
    }
    const next = page['@odata.nextLink'] || page['@odata.deltaLink'];
    if (!next) throw new Error('Graph delta response contained no continuation link');
    await saveDeltaLink(mailbox, folder, next);
    link = next;
    if (page['@odata.deltaLink']) break;
  }
  return processed;
}

export async function runEmailSync(config: EmailRuntimeConfig): Promise<{ processed: number; alerts: number; skipped: boolean }> {
  const lockClient = await getPostgresPool().connect();
  const lockKey = 872_615_901;
  let acquired = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [lockKey]);
    acquired = Boolean(lock.rows[0]?.locked);
    if (!acquired) return { processed: 0, alerts: 0, skipped: true };
    await ensureEmailTeam(config.mailboxes);
    let processed = 0;
    // Process all incoming copies before Sent Items so references can resolve.
    const teamFolderName = (process.env.MICROSOFT_CS_FOLDER_NAME || 'Team').trim().toLowerCase();
    for (const mailbox of config.mailboxes) {
      try {
        const folders = await config.graph.getMailFolders(mailbox);
        const team = folders.find((folder) => folder.displayName.trim().toLowerCase() === teamFolderName);
        if (team) processed += await syncFolder(config, mailbox, team.id, 'inbox');
        else await recordOptionalFolderAbsent(mailbox);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'Unknown sync error';
        await recordSyncFailure(mailbox, 'team', code).catch(() => undefined);
        console.error('[EMAIL] Team sync failure', { mailbox, code });
      }
      // Some tenants deliver CS copies to Inbox as well. Dedupe is by RFC ID.
      try { processed += await syncFolder(config, mailbox, 'inbox', 'inbox'); }
      catch (error) {
        const code = error instanceof Error ? error.message : 'Unknown sync error';
        await recordSyncFailure(mailbox, 'inbox', code).catch(() => undefined);
        console.error('[EMAIL] Inbox sync failure', { mailbox, code });
      }
    }
    for (const mailbox of config.mailboxes) {
      try { processed += await syncFolder(config, mailbox, 'sentitems', 'sentitems'); }
      catch (error) {
        const code = error instanceof Error ? error.message : 'Unknown sync error';
        await recordSyncFailure(mailbox, 'sentitems', code).catch(() => undefined);
        console.error('[EMAIL] Sent Items sync failure', { mailbox, code });
      }
    }
    const alerts = await emitDueAlerts(await getEmailSettings());
    if (processed || alerts) console.info('[EMAIL] Sync cycle', { processed, alerts });
    return { processed, alerts, skipped: false };
  } finally {
    if (acquired) await lockClient.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
    lockClient.release();
  }
}

export function startEmailPolling(config: EmailRuntimeConfig): void {
  const tick = () => { void runEmailSync(config).catch((error) => console.error('[EMAIL] Sync cycle failed', error)); };
  tick();
  setInterval(tick, 60_000).unref();
}

export async function getEmailSyncHealth() {
  return emailHealth();
}
