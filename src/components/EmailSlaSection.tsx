import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, Mail, RefreshCw, Settings2 } from 'lucide-react';
import { emailDeadlineLabel } from '../../shared/emailDeadlineLabel';
import { emailCompletionOutcome, emailCompletionTime } from '../../shared/emailCompletionLabel';
import { EmailSlaReports } from './EmailSlaReports';

type Thread = {
  id: number; subject: string; customer_email: string; received_at: string;
  first_response_at: string | null; resolved_at: string | null;
  response_due_at: string; resolution_due_at: string; status: string;
  response_breached: boolean; resolution_breached: boolean;
  owner_email: string | null; owner_name: string | null;
  assignment_method: string | null;
  assignment_reason: string | null; outlook_web_link: string | null;
  resolved_by: string | null; responded_by: string | null; resolution_note: string | null;
  sla_settings_snapshot: Settings | null;
};
type TeamMember = {
  id: number; email: string; display_name: string;
  is_available: boolean; round_robin_enabled: boolean; is_monitored: boolean;
};
type Alert = { id: number; email_thread_id: number; alert_type: string; emitted_at: string; subject: string; owner_name: string | null };
type AssignmentNotice = { id: number; email_thread_id: number; created_at: string; subject: string; customer_email: string; method: string };
type Summary = {
  total_received: number; unassigned: number; awaiting_response: number; in_progress: number;
  resolved_today: number; near_sla: number; breached: number;
  response_met: number; responded: number; resolution_met: number; resolved: number;
};
type Settings = {
  responseMinutes: number; responseWarningMinutes: number; responseUrgentMinutes: number;
  resolutionMinutes: number; resolutionWarningMinutes: number; resolutionUrgentMinutes: number;
  holidayDates: string[];
};

const alertSeverity = (type: string) => type.endsWith('_BREACH') ? 3 : type.endsWith('_URGENT') ? 2 : type.endsWith('_WARNING') ? 1 : 0;
const alertStage = (type: string) => type.startsWith('RESPONSE_') ? 'response' : type;
const isSystemAlert = (alert: Alert) => {
  const subject = alert.subject.trim().toLowerCase();
  return subject.startsWith('automatic reply:') || subject.startsWith('out of office') ||
    subject.startsWith('delivery status notification') || subject.startsWith('reaction daily digest');
};

function actionableAlerts(alerts: Alert[]) {
  const current = new Map<string, Alert>();
  for (const alert of alerts) {
    if (isSystemAlert(alert)) continue;
    const key = `${alert.email_thread_id}:${alertStage(alert.alert_type)}`;
    const previous = current.get(key);
    if (!previous || alertSeverity(alert.alert_type) > alertSeverity(previous.alert_type)) current.set(key, alert);
  }
  return [...current.values()].sort((a, b) => alertSeverity(b.alert_type) - alertSeverity(a.alert_type) ||
    new Date(b.emitted_at).getTime() - new Date(a.emitted_at).getTime());
}

const minuteFields = [
  'responseMinutes', 'responseWarningMinutes', 'responseUrgentMinutes',
] as const;

const filters = [
  ['all', 'All'], ['unassigned', 'Unassigned'], ['awaiting', 'Awaiting response'],
  ['breached', 'Overdue'], ['resolved', 'Responded'],
] as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

function SlaCell({ completedAt, dueAt, label, now, settings, closedAt }: {
  completedAt: string | null; dueAt: string; label: string; now: number; settings: Settings | null; closedAt?: string | null;
}) {
  if (completedAt) {
    const late = new Date(completedAt) > new Date(dueAt);
    return <div className="space-y-1">
      <p className="font-semibold text-slate-800">{label}</p>
      <time dateTime={completedAt} className="block text-xs text-slate-600">{emailCompletionTime(completedAt)}</time>
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${late ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
        {emailCompletionOutcome(completedAt, dueAt, settings?.holidayDates)}
      </span>
    </div>;
  }
  if (closedAt) return <span className="text-xs text-amber-700">Closed without detected reply</span>;
  const overdue = new Date(dueAt).getTime() <= now;
  return <span className={`font-medium ${overdue ? 'text-red-700' : 'text-slate-700'}`}>
    {emailDeadlineLabel(dueAt, false, now, settings)}
  </span>;
}

export function EmailSlaSection({ employeeEmail }: { employeeEmail?: string }) {
  const isEmployee = Boolean(employeeEmail);
  const [view, setView] = useState<'queue' | 'reports'>('queue');
  const [reportRefreshToken, setReportRefreshToken] = useState(0);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [assignmentNotices, setAssignmentNotices] = useState<AssignmentNotice[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filter, setFilter] = useState(isEmployee ? 'awaiting' : 'all');
  const [owner, setOwner] = useState('');
  const [receivedFrom, setReceivedFrom] = useState('');
  const [receivedTo, setReceivedTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const status = await api<{ enabled: boolean }>('/api/email/status');
      setEnabled(status.enabled);
      if (!status.enabled) return;
      const query = new URLSearchParams({
        filter,
        ...(owner ? { owner } : {}),
        ...(receivedFrom ? { from: receivedFrom } : {}),
        ...(receivedTo ? { to: receivedTo } : {}),
      });
      const [nextThreads, nextMembers, nextAlerts, nextSummary, nextSettings, nextNotices] = await Promise.all([
        api<Thread[]>(`/api/email/threads?${query}`), api<TeamMember[]>(isEmployee ? '/api/email/assignment-targets' : '/api/email/team'),
        api<Alert[]>('/api/email/alerts'), api<Summary>('/api/email/summary'), api<Settings>('/api/email/settings'),
        isEmployee ? api<AssignmentNotice[]>('/api/email/assignment-notifications') : Promise.resolve([] as AssignmentNotice[]),
      ]);
      setThreads(nextThreads); setMembers(nextMembers); setAlerts(nextAlerts);
      setSummary(nextSummary); setSettings(nextSettings); setAssignmentNotices(nextNotices);
      setError('');
    } catch (cause) { setError((cause as Error).message); }
  }, [filter, owner, receivedFrom, receivedTo, isEmployee]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 30_000);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(interval); clearInterval(clock); };
  }, [refresh]);

  async function action(url: string, payload?: unknown) {
    setBusy(true);
    try {
      await api(url, { method: 'POST', ...(payload ? { body: JSON.stringify(payload) } : {}) });
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    try {
      await api('/api/email/settings', { method: 'PUT', body: JSON.stringify(settings) });
      setShowSettings(false); await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function openOutlook(thread: Thread) {
    const popup=window.open('about:blank','_blank');
    if (!popup) { setError('Allow popups to open Outlook, or open Outlook directly and search the email subject.'); return; }
    popup.opener=null;
    try {
      const data=await api<{url:string;mailbox:string}>(`/api/email/threads/${thread.id}/outlook`);
      popup.location.href=data.url;
    } catch(cause) { popup.close(); setError((cause as Error).message); }
  }

  async function updateMember(member: TeamMember, field: 'isAvailable' | 'roundRobinEnabled', value: boolean) {
    setBusy(true);
    try {
      await api(`/api/email/team/${member.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  const cards = summary ? [
    ['Awaiting response', summary.awaiting_response], ['Near SLA', summary.near_sla],
    ['Overdue', summary.breached], ['Responded today', summary.resolved_today],
    ...(!isEmployee ? [['Unassigned', summary.unassigned] as [string, number]] : []),
  ] : [];
  const displayedAlerts = actionableAlerts(alerts);
  const breachAlerts = displayedAlerts.filter((alert) => alert.alert_type.endsWith('_BREACH')).length;
  const urgentAlerts = displayedAlerts.filter((alert) => alert.alert_type.endsWith('_URGENT')).length;
  const warningAlerts = displayedAlerts.filter((alert) => alert.alert_type.endsWith('_WARNING')).length;

  return <main className="max-w-7xl mx-auto px-3 sm:px-6 py-7 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold flex items-center gap-2"><Mail className="w-5 h-5 text-[#ff353e]" /> {isEmployee ? 'My CS emails' : 'Email SLA'}</h2>
        <p className="text-sm text-slate-500">{isEmployee ? `Assigned to ${employeeEmail}. Any CS reply closes the ticket automatically after sync.` : 'One actionable inbound email, one response ticket'}</p></div>
      <div className="flex gap-2">
        {!isEmployee && <button onClick={() => setShowSettings(!showSettings)} className="px-3 py-2 rounded-lg border text-sm flex items-center gap-2"><Settings2 className="w-4 h-4" /> Settings</button>}
        <button onClick={() => { void refresh(); setReportRefreshToken(value => value + 1); }} className="px-3 py-2 rounded-lg border text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>
    </div>
    {error && <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</p>}
    {enabled === false && <div className="p-5 rounded-xl border bg-amber-50 text-amber-900 text-sm">Email SLA is not enabled on this service yet. Existing call and SMS reporting is unaffected.</div>}
    {enabled && <nav aria-label="Email SLA views" className="flex gap-2 border-b border-slate-200 pb-3">{(['queue','reports'] as const).map(tab => <button key={tab} onClick={() => setView(tab)} aria-pressed={view === tab} className={`rounded-lg px-4 py-2 text-sm font-medium ${view === tab ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}>{tab === 'queue' ? 'Email queue' : 'Reports'}</button>)}</nav>}
    {enabled && view === 'reports' && <EmailSlaReports employeeEmail={employeeEmail} members={members} refreshToken={reportRefreshToken} />}
    {enabled && view === 'queue' && <>
      {isEmployee && assignmentNotices.length > 0 && <section className="p-4 rounded-xl border border-blue-200 bg-blue-50">
        <h3 className="font-semibold text-sm">New assignments ({assignmentNotices.length})</h3>
        <div className="mt-2 space-y-2">{assignmentNotices.map((notice) => <div key={notice.id} className="flex flex-wrap justify-between gap-2 text-xs">
          <span>#{notice.email_thread_id} · {notice.subject || '(no subject)'} · {notice.customer_email} · {notice.method.toLowerCase().replaceAll('_', ' ')}</span>
          <button disabled={busy} onClick={() => void action(`/api/email/assignment-notifications/${notice.id}/seen`)} className="font-semibold underline">Mark seen</button>
        </div>)}</div>
      </section>}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map(([label, value]) => <div key={label} className="p-4 rounded-xl border bg-white"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold mt-1">{value}</p></div>)}
      </div>
      <div className="p-4 rounded-xl border bg-white"><p className="font-semibold text-sm">Response SLA</p><p className="text-2xl font-bold">{summary?.responded ? `${Math.round(100 * summary.response_met / summary.responded)}%` : 'N/A'}</p><p className="text-xs text-slate-500">{summary?.response_met || 0} of {summary?.responded || 0} tickets answered within SLA</p></div>
      {displayedAlerts.length > 0 && <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
        <button type="button" aria-expanded={showAlerts} onClick={() => setShowAlerts((visible) => !visible)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-amber-50/60">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-amber-600" /> SLA alerts</span>
          <span className="flex flex-wrap items-center gap-2 text-xs">
            {breachAlerts > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-700">{breachAlerts} critical</span>}
            {urgentAlerts > 0 && <span className="rounded-full bg-orange-100 px-2.5 py-1 font-semibold text-orange-700">{urgentAlerts} urgent</span>}
            {warningAlerts > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">{warningAlerts} warning</span>}
            <span className="inline-flex items-center gap-1 font-medium text-slate-600">{showAlerts ? 'Hide alerts' : 'View alerts'} <ChevronDown className={`h-4 w-4 transition-transform ${showAlerts ? 'rotate-180' : ''}`} /></span>
          </span>
        </button>
        {showAlerts && <div className="max-h-72 divide-y overflow-auto border-t border-amber-100">
          {displayedAlerts.map((alert) => <div key={alert.id} className="flex items-start justify-between gap-4 px-4 py-3 text-xs">
            <div className="min-w-0"><p className="font-semibold text-slate-800">{alert.alert_type.replaceAll('_', ' ')}</p><p className="mt-0.5 truncate text-slate-600">#{alert.email_thread_id} · {alert.owner_name || 'Unassigned'} · {alert.subject || '(no subject)'}</p></div>
            <button disabled={busy} onClick={() => void action(`/api/email/alerts/${alert.id}/acknowledge`)} className="shrink-0 font-semibold text-blue-700 hover:underline disabled:opacity-50">Acknowledge</button>
          </div>)}
        </div>}
      </section>}
      {!isEmployee && showSettings && settings && <section className="p-4 rounded-xl border bg-white"><h3 className="font-semibold">Email SLA settings (minutes)</h3><div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
        {minuteFields.map((key) => <label key={key} className="text-xs text-slate-600">{key.replace(/([A-Z])/g, ' $1')}<input className="block mt-1 w-full border rounded-lg px-2 py-1.5" type="number" min="1" value={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} /></label>)}
      </div><p className="mt-4 text-xs text-slate-600">SLA hours: Monday-Friday, 8:00 AM-5:00 PM Nairobi time. The clock pauses outside these hours and on the dates below.</p>
      <label className="block mt-3 text-xs text-slate-600">Kenyan public holidays (YYYY-MM-DD, one per line)
        <textarea className="block mt-1 w-full border rounded-lg px-2 py-1.5 min-h-24" value={settings.holidayDates.join('\n')}
          onChange={(event) => setSettings({ ...settings, holidayDates: event.target.value.split(/[,\n]/).map((date) => date.trim()).filter(Boolean) })} />
      </label><p className="mt-1 text-xs text-slate-500">Changes to this calendar apply to new emails; historical deadlines stay as recorded.</p>
      <button disabled={busy} onClick={() => void saveSettings()} className="mt-3 px-4 py-2 rounded-lg bg-[#ff353e] text-white text-sm">Save settings</button></section>}
      {!isEmployee && showSettings && <section className="p-4 rounded-xl border bg-white">
        <h3 className="font-semibold">CS assignment rotation</h3>
        <p className="mt-1 text-xs text-slate-600">A message addressed to one available member goes to them first; otherwise a matching rule applies, then the next available person in round-robin. Changes affect new assignments only.</p>
        <div className="mt-3 grid md:grid-cols-2 gap-2">{members.filter((member) => member.is_monitored).map((member) => <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
          <span><strong>{member.display_name}</strong><span className="block text-xs text-slate-500">{member.email}</span></span>
          <span className="flex gap-3 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={member.is_available} disabled={busy} onChange={(event) => void updateMember(member, 'isAvailable', event.target.checked)} />Available</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={member.round_robin_enabled} disabled={busy} onChange={(event) => void updateMember(member, 'roundRobinEnabled', event.target.checked)} />Rotation</label></span>
        </div>)}</div>
      </section>}
      <section className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h3 className="font-semibold">CS emails</h3><p className="mt-1 text-xs text-slate-500">All times are Nairobi time (UTC+3). SLA counts Mon–Fri, 08:00–17:00, excluding configured holidays. Auto-refreshes every 30 seconds.</p></div><div className="flex flex-wrap gap-2">
        <select aria-label="Email status filter" value={filter} onChange={(event) => setFilter(event.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">{filters.filter(([value]) => !isEmployee || value !== 'unassigned').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {!isEmployee && <select aria-label="Email owner filter" value={owner} onChange={(event) => setOwner(event.target.value)} className="border rounded-lg px-2 py-1.5 text-sm"><option value="">All owners</option>{members.map((member) => <option key={member.id} value={member.email}>{member.display_name}</option>)}</select>}
        <label className="flex items-center gap-2 text-xs text-slate-500"><span>From</span><input aria-label="Emails received from" title="Start of received-date range" type="date" value={receivedFrom} max={receivedTo || undefined} onChange={(event) => setReceivedFrom(event.target.value)} className="border rounded-lg px-2 py-1.5 text-sm text-slate-800" /></label>
        <label className="flex items-center gap-2 text-xs text-slate-500"><span>To</span><input aria-label="Emails received to" title="End of received-date range" type="date" value={receivedTo} min={receivedFrom || undefined} onChange={(event) => setReceivedTo(event.target.value)} className="border rounded-lg px-2 py-1.5 text-sm text-slate-800" /></label>
      </div></div>
        <div className="space-y-3">
          {threads.map((thread) => <article key={thread.id} className="grid min-w-0 gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,.7fr)_minmax(0,.8fr)_minmax(0,.9fr)]">
            <div className="min-w-0">
              <span className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${thread.status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{thread.status === 'RESOLVED' ? 'RESPONDED' : thread.status.replaceAll('_', ' ')}</span>
              <p className="mt-2 break-words font-semibold">{thread.subject || '(no subject)'}</p>
              <p className="mt-1 break-all text-xs text-slate-500">{thread.customer_email}</p>
              <p className="mt-1 text-xs text-slate-500">Received {emailCompletionTime(thread.received_at)}</p>
            </div>
            <div className="min-w-0 rounded-lg bg-slate-50 p-3">
              <p className="mb-2 text-xs text-slate-500">Owner</p>
              <p className="break-words text-sm font-semibold text-slate-800">{thread.owner_name || 'Unassigned'}</p>
            </div>
            <div className="min-w-0 rounded-lg bg-slate-50 p-3">
              <div className="min-w-0"><p className="mb-2 text-xs text-slate-500">Response SLA</p><SlaCell completedAt={thread.first_response_at} dueAt={thread.response_due_at} label="Responded" now={now} settings={thread.sla_settings_snapshot} closedAt={thread.resolved_at} /></div>
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void openOutlook(thread)} title={`Open in Outlook signed in as ${thread.owner_email || 'the assigned agent'}`} aria-label={`Open ${thread.subject || 'email'} in Outlook`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 focus-visible:ring-2 focus-visible:ring-blue-500"><Mail aria-hidden="true" className="h-4 w-4" /></button>
                {thread.status !== 'RESOLVED' && <button disabled={busy} onClick={() => void action(`/api/email/threads/${thread.id}/no-response-required`)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700">No response needed</button>}
              </div>
              <details className="text-xs text-slate-600"><summary className="cursor-pointer font-medium">Details{thread.status !== 'RESOLVED' ? ' / reassign' : ''}</summary>
                <div className="mt-2 space-y-2 break-words">
                  {thread.assignment_reason && <p>{thread.assignment_reason}</p>}
                  {thread.first_response_at && <p>Responded by {thread.responded_by || 'CS team member'}</p>}
                  {thread.resolution_note && <p>{thread.resolution_note}</p>}
                  {thread.status !== 'RESOLVED' && <select aria-label={`Assign thread ${thread.id}`} value="" disabled={busy} onChange={(event) => void action(`/api/email/threads/${thread.id}/assign`, { memberId: Number(event.target.value) })} className="w-full min-w-0 rounded-lg border px-2 py-2"><option value="">Assign / reassign</option>{members.filter((member) => member.is_monitored).map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select>}
                </div>
              </details>
            </div>
          </article>)}
          {!threads.length && <p className="py-8 text-center text-sm text-slate-500">No email conversations match this filter.</p>}
        </div>
      </section>
    </>}
  </main>;
}
