// src/components/PendingApprovalSection.tsx
// Pending Approval: clears the jobs that are valued and submitted but cannot be approved until documents arrive
// (logbook, sticker, instruction letter and so on). Each job is routed to the right follow-up (phone the solver, email the AM
// team, email the insurer), every attempt is recorded, and conversion against a target is reported.
// Built from the Pending Approvals Desk designed by the section's manager.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ClipboardCheck, Mail, Settings as SettingsIcon } from 'lucide-react';
import { type ApprovalContext, type SolverMap, solverKey } from '../../shared/pendingApproval';
import { api, type ApprovalState, type Shared } from './pendingApproval/api';
import { Dashboard } from './pendingApproval/Dashboard';
import { Queue } from './pendingApproval/Queue';
import { EmailLog, SettingsTab } from './pendingApproval/Settings';
import { Note } from './pendingApproval/ui';

type Tab = 'queue' | 'dashboard' | 'log' | 'settings';
const TABS: Array<{ id: Tab; label: string; Icon: React.ElementType }> = [
  { id: 'queue', label: 'Work Queue', Icon: ClipboardCheck },
  { id: 'dashboard', label: 'KPI Dashboard', Icon: BarChart3 },
  { id: 'log', label: 'Email Log', Icon: Mail },
  { id: 'settings', label: 'Import & Settings', Icon: SettingsIcon },
];
const POLL_MS = 10_000;

export default function PendingApprovalSection({ isAdmin, signedInAgentName }: { isAdmin: boolean; signedInAgentName: string | null }) {
  const [tab, setTab] = useState<Tab>('queue');
  const [state, setState] = useState<ApprovalState | null>(null);
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const revision = useRef('');
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((text: string, bad = false) => {
    setToastMsg({ text, bad });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 5000);
  }, []);

  // The browser asks with the revision it already has and only downloads the jobs when something changed.
  const load = useCallback(async (force = false) => {
    try {
      const d = await api<ApprovalState & { unchanged?: boolean }>('GET', `/api/pending-approvals/state${!force && revision.current ? `?rev=${encodeURIComponent(revision.current)}` : ''}`);
      if (d.unchanged) { setState((s) => (s ? { ...s, mail: d.mail } : s)); setError(''); return; }
      revision.current = d.revision;
      setState(d);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load(true);
    const t = window.setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.clearTimeout(toastTimer.current); };
  }, [load]);

  const actor = state?.me.name || signedInAgentName || 'Unknown';
  const shared: Shared | null = useMemo(() => {
    if (!state) return null;
    const solvers: SolverMap = Object.fromEntries(state.solvers.map((s) => [solverKey(s.name), s]));
    const ctx: ApprovalContext = { dir: state.directory, solvers, senderName: actor };
    return { state, ctx, actor, reload: () => load(true), toast };
  }, [state, actor, load, toast]);

  return (
    <div className="space-y-4" id="pending-approval-section">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center flex-shrink-0"><ClipboardCheck className="w-4 h-4" /></div>
          <div>
            <h2 className="text-sm font-black text-slate-900">Pending Approval</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Jobs that are valued and submitted but cannot be approved because documents are missing. Follow them up, record every attempt and clear them.</p>
          </div>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl self-start" role="tablist">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} id={`pa-tab-${id}`} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${tab === id ? 'bg-white text-[#ff353e] shadow-xs' : 'text-slate-600 hover:text-[#ff353e]'}`}>
              <Icon className="w-3.5 h-3.5" /><span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <Note bad>{error} <button type="button" className="underline font-bold cursor-pointer" onClick={() => load(true)}>Try again</button></Note>}
      {state && shared && tab !== 'settings' && !state.mail.configured && (
        <Note>Email is not configured on the server yet, so emails cannot be sent from here. Everything else works: logging outcomes, closing jobs and reports are not affected.{isAdmin ? ' The setup steps are in Import & Settings.' : ' Ask an administrator to set it up.'}</Note>
      )}
      {state && shared && tab !== 'settings' && state.mail.configured && !state.mail.verified && (
        <Note>{state.mail.can_send ? 'Email sending has not been verified for your mailbox yet, so an email may fail to send.' : 'No sender mailbox is set for your login, so emails cannot be sent from here.'}{isAdmin ? ' Complete the check in Import & Settings (Access and email sending).' : ' Ask an administrator to complete the email check.'} Everything else works.</Note>
      )}

      {!state && !error && <div className="text-xs text-slate-500 p-6">Loading Pending Approval…</div>}
      {state && shared && (
        <>
          {tab === 'queue' && <Queue shared={shared} targetConv={state.settings.target_conversion} />}
          {tab === 'dashboard' && <Dashboard shared={shared} targetConv={state.settings.target_conversion} />}
          {tab === 'log' && <EmailLog revision={state.revision} />}
          {tab === 'settings' && <SettingsTab shared={shared} isAdmin={isAdmin} />}
        </>
      )}

      {toastMsg && (
        <div role="status" className={`fixed bottom-4 right-4 z-[60] max-w-sm rounded-xl border px-4 py-3 text-xs font-semibold shadow-lg ${toastMsg.bad ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-slate-900 border-slate-800 text-white'}`}>{toastMsg.text}</div>
      )}
    </div>
  );
}
