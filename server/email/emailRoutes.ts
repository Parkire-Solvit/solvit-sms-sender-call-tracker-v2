import { Router, type RequestHandler } from 'express';
import { requireAdmin } from '../auth/adminSession';
import { emailActor, requireEmailActor } from '../auth/emailUserSession';
import type { EmailRuntimeConfig } from './emailSyncService';
import { getEmailSyncHealth, runEmailSync } from './emailSyncService';
import {
  acknowledgeEmailAlert, assignEmailThread, emailSummary, getEmailSettings, listEmailAlerts,
  listEmailTeam, listEmailThreads, resolveEmailThread, setEmailSettings, updateEmailMember,
} from './emailRepository';

const safe = (handler: RequestHandler): RequestHandler => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

function positiveId(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function createEmailRouter(config: EmailRuntimeConfig | null): Router {
  const router = Router();
  const allowed = config?.mailboxes || [];
  router.use(requireEmailActor(allowed));
  router.get('/status', safe(async (request, response) => {
    response.json({ enabled: Boolean(config), sync: config && emailActor(request, allowed)?.role === 'admin' ? await getEmailSyncHealth() : [] });
  }));
  router.use((_, response, next) => {
    if (!config) return response.status(503).json({ error: 'Email SLA is not configured' });
    next();
  });

  router.get('/summary', safe(async (request, response) => {
    const actor = emailActor(request, allowed)!;
    response.json(await emailSummary(actor.role === 'employee' ? actor.email : undefined));
  }));
  router.get('/threads', safe(async (request, response) => {
    const filter = typeof request.query.filter === 'string' ? request.query.filter : 'all';
    const validFilters = new Set(['all', 'unassigned', 'awaiting', 'in-progress', 'resolved', 'breached']);
    if (!validFilters.has(filter)) return response.status(400).json({ error: 'Invalid thread filter' });
    const actor = emailActor(request, allowed)!;
    const owner = actor.role === 'employee' ? actor.email! : (typeof request.query.owner === 'string' ? request.query.owner.trim() : '');
    if (owner && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner) || !config!.mailboxes.includes(owner.toLowerCase()))) {
      return response.status(400).json({ error: 'Invalid owner' });
    }
    response.json(await listEmailThreads(filter, owner || undefined));
  }));
  router.get('/alerts', safe(async (request, response) => {
    const actor = emailActor(request, allowed)!;
    response.json(await listEmailAlerts(actor.role === 'employee' ? actor.email : undefined));
  }));
  router.get('/settings', safe(async (_request, response) => response.json(await getEmailSettings())));
  router.post('/alerts/:id/acknowledge', safe(async (request, response) => {
    const id = positiveId(request.params.id);
    if (!id) return response.status(400).json({ error: 'Invalid alert ID' });
    const actor = emailActor(request, allowed)!;
    const updated = await acknowledgeEmailAlert(id, actor.role === 'employee' ? actor.email : undefined);
    response.status(updated ? 200 : 404).json(updated ? { success: true } : { error: 'Alert not found' });
  }));
  router.use(requireAdmin);
  router.get('/team', safe(async (_request, response) => response.json(await listEmailTeam())));
  router.patch('/team/:id', safe(async (request, response) => {
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
  router.put('/settings', safe(async (request, response) => {
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
    const updated = await assignEmailThread(id, memberId);
    response.status(updated ? 200 : 404).json(updated ? { success: true } : { error: 'Thread or member not found' });
  }));
  router.post('/threads/:id/resolve', safe(async (request, response) => {
    const id = positiveId(request.params.id);
    if (!id) return response.status(400).json({ error: 'Invalid thread ID' });
    const updated = await resolveEmailThread(id);
    response.status(updated ? 200 : 404).json(updated ? { success: true } : { error: 'Open thread not found' });
  }));
  router.post('/sync', safe(async (_request, response) => response.json(await runEmailSync(config!))));
  return router;
}
