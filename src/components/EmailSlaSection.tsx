import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Mail, RefreshCw, Settings2 } from 'lucide-react';
import { emailDeadlineLabel } from '../../shared/emailDeadlineLabel';

type Thread = {
  id: number; subject: string; customer_email: string; received_at: string;
  first_response_at: string | null; resolved_at: string | null;
  response_due_at: string; resolution_due_at: string; status: string;
  response_breached: boolean; resolution_breached: boolean;
  owner_email: string | null; owner_name: string | null;
  assignment_method: string | null;
  resolved_by: string | null; resolution_note: string | null;
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

const minuteFields = [
  'responseMinutes', 'responseWarningMinutes', 'responseUrgentMinutes',
  'resolutionMinutes', 'resolutionWarningMinutes', 'resolutionUrgentMinutes',
] as const;

const filters = [
  ['all', 'All'], ['unassigned', 'Unassigned'], ['awaiting', 'Awaiting response'],
  ['in-progress', 'In progress'], ['breached', 'Breached'], ['resolved', 'Resolved'],
] as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export function EmailSlaSection({ employeeEmail }: { employeeEmail?: string }) {
  const isEmployee = Boolean(employeeEmail);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [assignmentNotices, setAssignmentNotices] = useState<AssignmentNotice[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filter, setFilter] = useState(isEmployee ? 'awaiting' : 'all');
  const [owner, setOwner] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<Thread | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const status = await api<{ enabled: boolean }>('/api/email/status');
      setEnabled(status.enabled);
      if (!status.enabled) return;
      const query = new URLSearchParams({
        filter,
        ...(owner ? { owner } : {}),
        ...(receivedDate ? { date: receivedDate } : {}),
      });
      const [nextThreads, nextMembers, nextAlerts, nextSummary, nextSettings, nextNotices] = await Promise.all([
        api<Thread[]>(`/api/email/threads?${query}`), isEmployee ? Promise.resolve([] as TeamMember[]) : api<TeamMember[]>('/api/email/team'),
        api<Alert[]>('/api/email/alerts'), api<Summary>('/api/email/summary'), api<Settings>('/api/email/settings'),
        isEmployee ? api<AssignmentNotice[]>('/api/email/assignment-notifications') : Promise.resolve([] as AssignmentNotice[]),
      ]);
      setThreads(nextThreads); setMembers(nextMembers); setAlerts(nextAlerts);
      setSummary(nextSummary); setSettings(nextSettings); setAssignmentNotices(nextNotices);
      setError('');
    } catch (cause) { setError((cause as Error).message); }
  }, [filter, owner, receivedDate, isEmployee]);

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

  async function updateMember(member: TeamMember, field: 'isAvailable' | 'roundRobinEnabled', value: boolean) {
    setBusy(true);
    try {
      await api(`/api/email/team/${member.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmResolve() {
    if (!resolveTarget) return;
    setBusy(true);
    try {
      await api(`/api/email/threads/${resolveTarget.id}/resolve`, {
        method: 'POST', body: JSON.stringify({ note: resolutionNote.trim() }),
      });
      setResolveTarget(null);
      setResolutionNote('');
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  const cards = summary ? [
    ['Awaiting response', summary.awaiting_response], ['Near SLA', summary.near_sla],
    ['In progress', summary.in_progress], ['Breached', summary.breached],
    ['Resolved today', summary.resolved_today], ...(!isEmployee ? [['Unassigned', summary.unassigned] as [string, number]] : []),
  ] : [];

  return <main className="max-w-7xl mx-auto px-6 py-7 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold flex items-center gap-2"><Mail className="w-5 h-5 text-[#ff353e]" /> {isEmployee ? 'My CS emails' : 'Email SLA'}</h2>
        <p className="text-sm text-slate-500">{isEmployee ? `Assigned to ${employeeEmail}. Reply in Outlook; this queue updates after sync.` : 'CS group email response and resolution tracking'}</p></div>
      <div className="flex gap-2">
        {!isEmployee && <button onClick={() => setShowSettings(!showSettings)} className="px-3 py-2 rounded-lg border text-sm flex items-center gap-2"><Settings2 className="w-4 h-4" /> Settings</button>}
        <button onClick={() => void refresh()} className="px-3 py-2 rounded-lg border text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>
    </div>
    {error && <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</p>}
    {enabled === false && <div className="p-5 rounded-xl border bg-amber-50 text-amber-900 text-sm">Email SLA is not enabled on this service yet. Existing call and SMS reporting is unaffected.</div>}
    {enabled && <>
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
      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border bg-white"><p className="font-semibold text-sm">Response SLA</p><p className="text-2xl font-bold">{summary?.responded ? `${Math.round(100 * summary.response_met / summary.responded)}%` : 'N/A'}</p><p className="text-xs text-slate-500">{summary?.response_met || 0} of {summary?.responded || 0} answered within SLA</p></div>
        <div className="p-4 rounded-xl border bg-white"><p className="font-semibold text-sm">Resolution SLA</p><p className="text-2xl font-bold">{summary?.resolved ? `${Math.round(100 * summary.resolution_met / summary.resolved)}%` : 'N/A'}</p><p className="text-xs text-slate-500">{summary?.resolution_met || 0} of {summary?.resolved || 0} resolved within SLA</p></div>
      </div>
      {alerts.length > 0 && <section className="p-4 rounded-xl border bg-amber-50"><h3 className="font-semibold text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Active alerts ({alerts.length})</h3><div className="mt-2 space-y-1 max-h-40 overflow-auto">{alerts.map((alert) => <div key={alert.id} className="flex justify-between gap-2 text-xs"><span>#{alert.email_thread_id} · {alert.alert_type.replaceAll('_', ' ')} · {alert.owner_name || 'Unassigned'} · {alert.subject}</span><button disabled={busy} onClick={() => void action(`/api/email/alerts/${alert.id}/acknowledge`)} className="font-semibold underline shrink-0">Acknowledge</button></div>)}</div></section>}
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
      <section className="p-4 rounded-xl border bg-white"><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><h3 className="font-semibold">CS emails</h3><div className="flex flex-wrap gap-2">
        <select aria-label="Email status filter" value={filter} onChange={(event) => setFilter(event.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">{filters.filter(([value]) => !isEmployee || value !== 'unassigned').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {!isEmployee && <select aria-label="Email owner filter" value={owner} onChange={(event) => setOwner(event.target.value)} className="border rounded-lg px-2 py-1.5 text-sm"><option value="">All owners</option>{members.map((member) => <option key={member.id} value={member.email}>{member.display_name}</option>)}</select>}
        <input aria-label="Email received date filter" title="Filter by received date" type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
      </div></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Received</th><th>Customer / subject</th><th>Owner</th><th>Response</th><th>Resolution</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {threads.map((thread) => <tr key={thread.id} className="border-b align-top">
            <td className="py-3 whitespace-nowrap">{new Date(thread.received_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</td>
            <td className="max-w-xs"><p className="font-medium truncate">{thread.subject || '(no subject)'}</p><p className="text-xs text-slate-500 truncate">{thread.customer_email}</p></td>
            <td>{thread.owner_name || 'Unassigned'}</td>
            <td className={thread.response_breached || (!thread.first_response_at && new Date(thread.response_due_at).getTime() <= now) ? 'text-red-700 font-semibold' : ''}>{emailDeadlineLabel(thread.response_due_at, Boolean(thread.first_response_at), now, thread.sla_settings_snapshot)}</td>
            <td className={thread.resolution_breached || (!thread.resolved_at && new Date(thread.resolution_due_at).getTime() <= now) ? 'text-red-700 font-semibold' : ''}>{emailDeadlineLabel(thread.resolution_due_at, Boolean(thread.resolved_at), now, thread.sla_settings_snapshot)}</td>
            <td>{thread.status.replaceAll('_', ' ')}{thread.resolved_at && <p className="mt-1 text-xs text-slate-500">By {thread.resolved_by || 'unrecorded'} · {new Date(thread.resolved_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</p>}{thread.resolution_note && <p className="text-xs text-slate-500">{thread.resolution_note}</p>}</td>
            <td className="min-w-44">{!isEmployee && thread.status !== 'RESOLVED' && <select aria-label={`Assign thread ${thread.id}`} value="" disabled={busy} onChange={(event) => void action(`/api/email/threads/${thread.id}/assign`, { memberId: Number(event.target.value) })} className="border rounded px-1 py-1 text-xs"><option value="">Assign / reassign</option>{members.filter((member) => member.is_monitored).map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select>}
              {thread.status !== 'RESOLVED' && (!isEmployee || thread.status === 'IN_PROGRESS') && <button disabled={busy} onClick={() => { setError(''); setResolveTarget(thread); setResolutionNote(''); }} className="ml-1 text-xs text-emerald-700 whitespace-nowrap">Mark resolved</button>}</td>
          </tr>)}
          {!threads.length && <tr><td colSpan={7} className="text-center py-8 text-slate-500">No email conversations match this filter.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
    {resolveTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="resolve-title" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 id="resolve-title" className="text-lg font-semibold">Confirm resolution</h3>
        <p className="mt-2 text-sm text-slate-700">Are you sure this customer issue is fully resolved? This will stop its resolution SLA clock.</p>
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><strong>{resolveTarget.subject || '(no subject)'}</strong><span className="block text-slate-500">{resolveTarget.customer_email}</span></p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <label className="mt-4 block text-sm font-medium">Resolution note (optional)
          <textarea autoFocus maxLength={500} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} className="mt-1 block min-h-20 w-full rounded-lg border p-2 text-sm" placeholder="Briefly describe what was completed" />
        </label>
        <p className="mt-2 text-xs text-slate-500">SMS Sender records your account and the time of confirmation.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setResolveTarget(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
          <button type="button" disabled={busy} onClick={() => void confirmResolve()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Yes, mark resolved</button>
        </div>
      </div>
    </div>}
  </main>;
}
