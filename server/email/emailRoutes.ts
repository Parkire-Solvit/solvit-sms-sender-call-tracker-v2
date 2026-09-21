import { Router, type RequestHandler } from 'express';
import { isAdminRequest, requireAdmin } from '../auth/adminSession';
import { emailMember } from '../auth/emailMemberSession';
import { getPostgresPool } from '../../db';
import { emailReportPeriod } from './emailReporting';
import { getEmailReport, emailReportWorkbook } from './emailReportService';
import { emailOutlookCopySql } from './emailOutlookLookup';
import type { EmailRuntimeConfig } from './emailSyncService';
import { getEmailSyncHealth, runEmailSync } from './emailSyncService';
import {
  acknowledgeEmailAlert, assignEmailThread, emailSummary, getEmailSettings, listEmailAlerts,
  listAssignmentNotifications, markAssignmentNotificationSeen, listEmailTeam, listEmailThreads,
  resolveEmailThread, setEmailSettings, updateEmailMember,
} from './emailRepository';

const safe = (handler: RequestHandler): RequestHandler => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

function positiveId(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function createEmailRouter(config: EmailRuntimeConfig | null): Router {
  const router = Router();
  router.use(safe(async (request, response, next) => {
    if (isAdminRequest(request)) { response.locals.emailOwner = null; next(); return; }
    const email = emailMember(request);
    if (!email || !config?.mailboxes.includes(email)) { response.status(401).json({ error: 'Authentication required' }); return; }
    const member = await getPostgresPool().query('SELECT 1 FROM email_team_members WHERE email=$1 AND is_monitored=true', [email]);
    if (!member.rowCount) { response.status(403).json({ error: 'Not an approved CS member' }); return; }
    response.locals.emailOwner = email;
    next();
  }));
  router.get('/status', safe(async (_request, response) => {
    response.json({ enabled: Boolean(config), sync: config && !response.locals.emailOwner ? await getEmailSyncHealth() : [] });
  }));
  router.use((_, response, next) => {
    if (!config) return response.status(503).json({ error: 'Email SLA is not configured' });
    next();
  });

  router.get('/summary', safe(async (_request, response) => response.json(await emailSummary(response.locals.emailOwner || undefined))));
  router.get(['/reports', '/reports/export'], safe(async (request, response) => {
    const now = new Date();
    let period;
    let owner: string;
    try {
      const kind = request.query.kind;
      if (kind !== 'weekly' && kind !== 'monthly' && kind !== 'custom') throw new Error('Choose weekly, monthly or custom');
      if (typeof request.query.anchor !== 'string') throw new Error('Choose a report date');
      period = emailReportPeriod(kind, request.query.anchor, typeof request.query.end === 'string' ? request.query.end : undefined);
      if (period.start > now || period.endExclusive.getTime()-period.start.getTime() > 366*86400000) throw new Error('Choose a past/current period of at most 366 days');
      // Never trust an owner parameter from an employee session.
      owner = response.locals.emailOwner || (typeof request.query.owner === 'string' ? request.query.owner.trim().toLowerCase() : '');
      if (owner && !config!.mailboxes.includes(owner)) throw new Error('Invalid report owner');
    } catch (cause) { return response.status(400).json({ error: (cause as Error).message }); }
    const report = await getEmailReport(period, now, owner || undefined);
    if (request.path === '/reports/export') {
      response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      response.setHeader('Content-Disposition',`attachment; filename="email-sla-${request.query.kind}-${request.query.anchor}.xlsx"`);
      response.setHeader('Cache-Control','no-store');
      return response.send(emailReportWorkbook(report));
    }
    response.setHeader('Cache-Control','no-store');
    response.json(report);
  }));
  router.get('/threads', safe(async (request, response) => {
    const filter = typeof request.query.filter === 'string' ? request.query.filter : 'all';
    const validFilters = new Set(['all', 'unassigned', 'awaiting', 'in-progress', 'resolved', 'breached']);
    if (!validFilters.has(filter)) return response.status(400).json({ error: 'Invalid thread filter' });
    const owner = response.locals.emailOwner || (typeof request.query.owner === 'string' ? request.query.owner.trim() : '');
    if (owner && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner) || !config!.mailboxes.includes(owner.toLowerCase()))) {
      return response.status(400).json({ error: 'Invalid owner' });
    }
    const legacyDate = typeof request.query.date === 'string' ? request.query.date.trim() : '';
    const receivedFrom = typeof request.query.from === 'string' ? request.query.from.trim() : legacyDate;
    const receivedTo = typeof request.query.to === 'string' ? request.query.to.trim() : legacyDate;
    if ((receivedFrom && !validCalendarDate(receivedFrom)) || (receivedTo && !validCalendarDate(receivedTo))) {
      return response.status(400).json({ error: 'Invalid received date range' });
    }
    if (receivedFrom && receivedTo && receivedFrom > receivedTo) {
      return response.status(400).json({ error: 'Received date range starts after it ends' });
    }
    response.json(await listEmailThreads(filter, owner || undefined, receivedFrom || undefined, receivedTo || undefined));
  }));
  router.get('/alerts', safe(async (_request, response) => response.json(await listEmailAlerts(response.locals.emailOwner || undefined))));
  router.get('/threads/:id/outlook', safe(async (request,response) => {
    const id=positiveId(request.params.id);
    if (!id) return response.status(400).json({error:'Invalid thread ID'});
    const result=await getPostgresPool().query(emailOutlookCopySql,[id,response.locals.emailOwner || null]);
    const copy=result.rows[0];
    if (!copy) return response.status(404).json({error:'Email not found in your queue'});
    if (!copy.graph_message_id) return response.status(409).json({error:'No copy has been synced in the assigned agent’s mailbox. Open Outlook and search the subject; reassignment does not grant mailbox access.'});
    try { return response.json({url:await config!.graph.getMessageWebLink(copy.email,copy.graph_message_id),mailbox:copy.email}); }
    catch { return response.status(502).json({error:'Microsoft could not open this mailbox copy. Sign in to Outlook with your CS email and search the subject while we verify synchronization.'}); }
  }));
  router.get('/assignment-notifications', safe(async (_request, response) => {
    response.json(response.locals.emailOwner ? await listAssignmentNotifications(response.locals.emailOwner) : []);
  }));
  router.post('/assignment-notifications/:id/seen', safe(async (request, response) => {
    if (!response.locals.emailOwner) return response.status(403).json({ error: 'CS member access required' });
    const id = positiveId(request.params.id);
    if (!id) return response.status(400).json({ error: 'Invalid notification ID' });
    const updated = await markAssignmentNotificationSeen(id, response.locals.emailOwner);
    response.status(updated ? 200 : 404).json(updated ? { success: true } : { error: 'Notification not found' });
  }));
  router.get('/settings', safe(async (_request, response) => response.json(await getEmailSettings())));
  router.post('/alerts/:id/acknowledge', safe(async (request, response) => {
    const id = positiveId(request.params.id);
    if (!id) return response.status(400).json({ error: 'Invalid alert ID' });
    const updated = await acknowledgeEmailAlert(id, response.locals.emailOwner || undefined);
    response.status(updated ? 200 : 404).json(updated ? { success: true } : { error: 'Alert not found' });
  }));
  router.get('/team', requireAdmin, safe(async (_request, response) => response.json(await listEmailTeam())));
  router.get('/assignment-targets', safe(async (_request,response) => {
    const team = await listEmailTeam();
    response.json(team.filter(m => m.is_monitored && config!.mailboxes.includes(m.email)).map(m => ({id:m.id,email:m.email,display_name:m.display_name,is_monitored:true})));
  }));
  router.patch('/team/:id', requireAdmin, safe(async (request, response) => {
    const id = positiveId(request.params.id);
    if (!id) return response.status(400).json({ error: 'Invalid team member ID' });
    const { isAvailable, roundRobinEnabled, displayName } = request.body || {};
    if ((isAvailable !== undefined && typeof isAvailable !== 'boolean') ||
      (roundRobinEnabled !== undefined && typeof roundRobinEnabled !== 'boolean') ||
      (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 100))) {
      return response.status(400).json({ error: 'Invalid team member update' });
    }
    const updated = await updateEmailMember(id, { isAvailable, roundRobinEnabled, displayName: displayName?.trim() });
    response.status(updated ? 200 : 404).json(updated ? { success: true } : { error: 'Team member not found' });
  }));
  router.put('/settings', requireAdmin, safe(async (request, response) => {
    try {
      await setEmailSettings(request.body);
      response.json({ success: true });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  }));
  router.post('/threads/:id/assign', safe(async (request, response) => {
    const id = positiveId(request.params.id);
    const memberId = positiveId(String(request.body?.memberId || ''));
    if (!id || !memberId) return response.status(400).json({ error: 'Valid thread and member IDs are required' });
    const team = await listEmailTeam();
    if (!team.some(m => Number(m.id) === memberId && m.is_monitored && config!.mailboxes.includes(m.email))) return response.status(400).json({error:'Choose an approved CS member'});
    const ownerEmail = response.locals.emailOwner || null;
    const updated = await assignEmailThread(id, memberId, ownerEmail, ownerEmail || 'admin');
    response.status(updated ? 200 : 404).json(updated ? { success: true } : { error: 'Thread or member not found' });
  }));
  router.post('/threads/:id/resolve', safe(async (request, response) => {
    const id = positiveId(request.params.id);
    if (!id) return response.status(400).json({ error: 'Invalid thread ID' });
    const rawNote = request.body?.note;
    if (rawNote !== undefined && (typeof rawNote !== 'string' || rawNote.length > 500)) {
      return response.status(400).json({ error: 'Resolution note must be 500 characters or less' });
    }
    const ownerEmail: string | null = response.locals.emailOwner || null;
    const actor = ownerEmail || process.env.ADMIN_USERNAME?.trim().toLowerCase() || 'admin';
    const updated = await resolveEmailThread(id, actor, ownerEmail, rawNote?.trim() || null);
    response.status(updated ? 200 : ownerEmail ? 409 : 404).json(updated ? { success: true } : {
      error: ownerEmail ? 'You can resolve only your own open email. A note is required if no reply has been detected.' : 'Open thread not found',
    });
  }));
  router.post('/sync', requireAdmin, safe(async (_request, response) => response.json(await runEmailSync(config!))));
  return router;
}
