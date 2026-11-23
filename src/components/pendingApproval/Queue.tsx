// Pending Approval: the work queue. Every open job, routed to the right follow-up, with filters, history and bulk actions.
import React, { useMemo, useState } from 'react';
import {
  ACTION_LABEL, DOC_NEEDED, FOLLOW_UP_DAYS, NOFU_REASONS, NONACT_AT, ROUTES, actionOf, attemptsOf, calls, daysBetween, fmtD, fmtDT, groupBy, isAm, lastAtt, mails, msgs, nAtt,
  nairobiYmd, nextStep, outText, routeOf, solverEmailOf, solverOf, type ApprovalJob, type ApprovalRoute,
} from '../../../shared/pendingApproval';
import { api, type Shared } from './api';
import { ComposeModal, LogOutcomeModal, ReceivedModal } from './Modals';
import { Panel, Pill, SourceBadge, Tile, btn, btnOk, btnPrimary, btnSm, field, th, toneOf } from './ui';

type Dialog =
  | { t: 'log'; id: string }
  | { t: 'compose'; kind: 'am' | 'ins'; key: string; list: ApprovalJob[] }
  | { t: 'received'; ids: string[] }
  | null;

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${on ? 'bg-slate-900 text-white shadow-sm' : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'}`;
const count = (on: boolean) => `px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${on ? 'bg-slate-700 text-slate-100' : 'bg-slate-200/80 text-slate-700'}`;

export function Queue({ shared, targetConv }: { shared: Shared; targetConv: number }) {
  const { state, ctx, reload, toast } = shared;
  const { jobs, directory: dir } = state;
  const [route, setRoute] = useState<'all' | ApprovalRoute>('all');
  const [actionF, setActionF] = useState('');
  const [q, setQ] = useState('');
  const [reasonF, setReasonF] = useState('');
  const [insurerF, setInsurerF] = useState('');
  const [initiatorF, setInitiatorF] = useState('');
  const [dFrom, setDFrom] = useState('');
  const [dTo, setDTo] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openHist, setOpenHist] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const now = Date.now();

  const open = useMemo(() => jobs.filter((j) => j.status !== 'closed'), [jobs]);
  const rOf = (j: ApprovalJob) => routeOf(j, dir);
  const cnt = (r: string) => open.filter((j) => rOf(j) === r).length;

  const list = useMemo(() => {
    const s = q.toLowerCase();
    return jobs
      .filter((j) => (showClosed || j.status !== 'closed') && (route === 'all' || rOf(j) === route) && (!reasonF || j.reason === reasonF) && (!insurerF || j.insurer === insurerF) &&
        (!initiatorF || j.initiated_by === initiatorF) &&
        (!actionF || (actionF === 'active' ? ['waiting', 'due'].includes(actionOf(j, now)) : actionOf(j, now) === actionF)) &&
        (!dFrom || nairobiYmd(j.val_date) >= dFrom) && (!dTo || nairobiYmd(j.val_date) <= dTo) &&
        (!s || [j.id, j.reg, j.policy_holder, j.insurer, j.solver, j.initiated_by, j.allocated_to].join(' ').toLowerCase().includes(s)))
      .sort((a, b) => new Date(a.val_date).getTime() - new Date(b.val_date).getTime());
  }, [jobs, showClosed, route, reasonF, insurerF, initiatorF, actionF, dFrom, dTo, q, dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewOpen = list.filter((j) => j.status !== 'closed');
  const fu = jobs.filter((j) => nAtt(j) > 0 || (j.status === 'closed' && j.closed_via !== 'export'));
  const fuApproved = fu.filter((j) => j.status === 'closed').length;
  const convTxt = fu.length ? `${Math.round((fuApproved / fu.length) * 1000) / 10}%` : '-';
  const fresh = open.filter((j) => !(j.attempts || []).length).length;
  const due = open.filter((j) => actionOf(j, now) === 'due').length;
  const non = open.filter((j) => actionOf(j, now) === 'nonact').length;
  const reasons = [...new Set(jobs.map((j) => j.reason))].sort();
  const insurers = [...new Set(jobs.map((j) => j.insurer))].sort();
  const initiators = [...new Set(jobs.map((j) => j.initiated_by).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const filtersOn = !!(q || initiatorF || insurerF || actionF || dFrom || dTo || reasonF);

  const inRoute = open.filter((j) => route === 'all' || rOf(j) === route);
  const actionCount = (k: string) => inRoute.filter((j) => (k === 'active' ? ['waiting', 'due'].includes(actionOf(j, now)) : actionOf(j, now) === k)).length;

  const openAm = (name: string, from: ApprovalJob[]) => setDialog({ t: 'compose', kind: 'am', key: name, list: from.filter((j) => rOf(j) === 'ref' && (j.initiated_by || 'Unknown') === name) });
  const openIns = (name: string, from: ApprovalJob[]) => setDialog({ t: 'compose', kind: 'ins', key: name, list: from.filter((j) => rOf(j) === 'cp' && (j.insurer || 'Unknown') === name) });

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try { await fn(); await reload(); if (done) toast(done); } catch (e) { toast(`Could not save: ${(e as Error).message}`, true); }
  };
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleHist = (id: string) => setOpenHist((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const amGroups = groupBy<ApprovalJob>(open.filter((j) => rOf(j) === 'ref'), (j) => j.initiated_by || 'Unknown');
  const cpGroups = groupBy<ApprovalJob>(open.filter((j) => rOf(j) === 'cp'), (j) => j.insurer || 'Unknown');
  const viewAm = groupBy<ApprovalJob>(viewOpen.filter((j) => rOf(j) === 'ref'), (j) => j.initiated_by || 'Unknown');
  const viewIns = groupBy<ApprovalJob>(viewOpen.filter((j) => rOf(j) === 'cp'), (j) => j.insurer || 'Unknown');

  const dialogJob = dialog?.t === 'log' ? jobs.find((j) => j.id === dialog.id) : undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Tile value={open.length} label="Open pending jobs" />
        <Tile value={fresh} label="Not actioned" tone="border-slate-200/80 text-rose-700" />
        <Tile value={open.length - fresh} label="Actioned, still pending" tone="border-slate-200/80 text-amber-700" />
        <Tile value={due} label={`Follow-up due (${FOLLOW_UP_DAYS}+ days)`} tone="border-slate-200/80 text-amber-700" />
        <Tile value={non} label={`Non-actionable (${NONACT_AT}+ follow-ups)`} tone="border-slate-200/80 text-slate-600" />
        <Tile value={jobs.length - open.length} label="Closed" tone="border-slate-200/80 text-emerald-700" />
        <Tile value={convTxt} label="Conversion" sub={`${fuApproved} approved of ${fu.length} followed up (target ${Math.round(targetConv * 100)}%)`} tone="bg-emerald-50 border-emerald-200 text-emerald-800" />
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Source">
        {([['all', 'All'], ...Object.entries(ROUTES)] as Array<[string, string]>).map(([k, v]) => (
          <button key={k} type="button" className={chip(route === k)} onClick={() => { setRoute(k as any); setSel(new Set()); }} aria-pressed={route === k}>
            {v}<span className={count(route === k)}>{k === 'all' ? open.length : cnt(k)}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Action status">
        {([['', 'All open'], ['none', 'Not actioned'], ['active', 'Actioned, still pending'], ['due', 'Follow-up due'], ['nonact', `Non-actionable (${NONACT_AT}+ follow-ups)`]] as Array<[string, string]>).map(([k, l]) => (
          <button key={k} type="button" className={chip(actionF === k)} onClick={() => setActionF(k)} aria-pressed={actionF === k}>
            {l}<span className={count(actionF === k)}>{k === '' ? inRoute.length : actionCount(k)}</span>
          </button>
        ))}
      </div>

      {route === 'ref' && (
        <Panel title="Email the AM team" how="One email per AM member, jobs grouped by insurance company, team group in copy.">
          <div className="flex flex-wrap gap-2">
            {Object.keys(amGroups).sort().map((n) => (
              <div key={n} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2">
                <div><b className="text-xs">{n}</b><div className="text-[10px] text-slate-500">{amGroups[n].length} open{isAm(dir, n) ? '' : ' · no address on file, goes to the team group'}</div></div>
                <button type="button" className={`${btnPrimary} ${btnSm}`} onClick={() => openAm(n, open)}>Compose</button>
              </div>
            ))}
            {!Object.keys(amGroups).length && <span className="text-[11px] text-slate-500">Nothing open.</span>}
          </div>
        </Panel>
      )}
      {route === 'cp' && (
        <Panel title="Email the insurance companies" how="One email per insurer for channel partner and not-recorded jobs. CS team in copy.">
          <div className="flex flex-wrap gap-2">
            {Object.keys(cpGroups).sort().map((n) => (
              <div key={n} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2">
                <div><b className="text-xs">{n}</b><div className="text-[10px] text-slate-500">{cpGroups[n].length} open · {cpGroups[n][0].insurer_email || 'no email on file'}</div></div>
                <button type="button" className={`${btnPrimary} ${btnSm}`} onClick={() => openIns(n, open)}>Compose</button>
              </div>
            ))}
            {!Object.keys(cpGroups).length && <span className="text-[11px] text-slate-500">Nothing open.</span>}
          </div>
        </Panel>
      )}
      {route === 'solver' && (
        <Panel><p className="text-[11px] text-slate-600">Call the solver first. They either confirm they have the documents or give the broker/agent contact; log the outcome and call the contact next. Broker-initiated jobs follow the same steps.</p></Panel>
      )}
      {filtersOn && viewOpen.length > 0 && (Object.keys(viewAm).length > 0 || Object.keys(viewIns).length > 0) && (
        <Panel title="Email the jobs in this view" how={`One email per person, with only the ${viewOpen.length} open job(s) currently shown, grouped by insurance company, plus an Excel list you can download.`}>
          <div className="flex flex-wrap gap-2">
            {Object.keys(viewAm).sort().map((n) => (
              <div key={`a${n}`} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2">
                <div><b className="text-xs">{n}</b><div className="text-[10px] text-slate-500">{viewAm[n].length} job(s) in this view · AM email</div></div>
                <button type="button" className={`${btnPrimary} ${btnSm}`} onClick={() => openAm(n, viewOpen)}>Email</button>
              </div>
            ))}
            {Object.keys(viewIns).sort().map((n) => (
              <div key={`i${n}`} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2">
                <div><b className="text-xs">{n}</b><div className="text-[10px] text-slate-500">{viewIns[n].length} job(s) in this view · insurer email</div></div>
                <button type="button" className={`${btnPrimary} ${btnSm}`} onClick={() => openIns(n, viewOpen)}>Email</button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="bg-white border border-slate-200/80 rounded-2xl p-3 shadow-xs flex flex-wrap items-end gap-2">
        <input type="search" className={`${field} !w-56`} placeholder="Search reg, policy holder, solver…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className={`${field} !w-auto`} value={reasonF} onChange={(e) => setReasonF(e.target.value)} aria-label="Document reason"><option value="">All document reasons</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select>
        <select className={`${field} !w-auto`} value={insurerF} onChange={(e) => setInsurerF(e.target.value)} aria-label="Insurance company"><option value="">All insurance companies</option>{insurers.map((r) => <option key={r}>{r}</option>)}</select>
        <select className={`${field} !w-auto`} value={initiatorF} onChange={(e) => setInitiatorF(e.target.value)} aria-label="Initiator"><option value="">All initiators (AM, solver, partner)</option>{initiators.map((r) => <option key={r}>{r}</option>)}</select>
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">Valuation from <input type="date" className={`${field} !w-auto`} value={dFrom} onChange={(e) => setDFrom(e.target.value)} /></label>
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">to <input type="date" className={`${field} !w-auto`} value={dTo} onChange={(e) => setDTo(e.target.value)} /></label>
        {filtersOn && <button type="button" className={`${btn} ${btnSm}`} onClick={() => { setInsurerF(''); setInitiatorF(''); setActionF(''); setDFrom(''); setDTo(''); setReasonF(''); setQ(''); }}>Clear filters</button>}
        <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed</label>
        <span className="text-[11px] text-slate-500">{list.length} shown</span>
        <span className="flex-1" />
        <select className={`${field} !w-auto`} aria-label="Set reason for no follow-up on selected jobs" value=""
          onChange={async (e) => {
            const v = e.target.value; if (!v) return;
            if (!sel.size) { toast('Tick the jobs first', true); return; }
            try {
              const r = await api<{ updated: number }>('POST', '/api/pending-approvals/jobs/no-follow-up-reason', { ids: [...sel], reason: v });
              setSel(new Set()); await reload(); toast(`${r.updated} job(s) updated`);
            } catch (err) { toast(`Could not save: ${(err as Error).message}`, true); }
          }}>
          <option value="">Set "why no follow-up" for selected…</option>{NOFU_REASONS.map((x) => <option key={x}>{x}</option>)}
        </select>
        <button type="button" className={btnOk} disabled={!sel.size} onClick={() => setDialog({ t: 'received', ids: [...sel] })}>Document received ({sel.size})</button>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs min-w-[1100px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200/80">
              <th className={th}></th><th className={th}>Source</th><th className={th}>Job</th><th className={th}>Valuation</th><th className={th}>Insurer</th><th className={th}>Solver contact</th>
              <th className={th}>Allocated to</th><th className={th}>Document needed</th><th className={`${th} text-right`}>Attempts</th><th className={th}>Status and next step</th><th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((j) => {
              const r = rOf(j), ns = nextStep(j, dir, now), l = lastAtt(j), age = daysBetween(j.val_date, now), closed = j.status === 'closed', sp = solverOf(ctx.solvers, j.solver);
              const act1 = actionOf(j, now), lab = ACTION_LABEL[act1];
              const bc = [...attemptsOf(j)].reverse().find((a) => a.outcome === 'gave_contact' && a.contact);
              return (
                <React.Fragment key={j.id}>
                  <tr className={closed ? 'opacity-60' : ''}>
                    <td className="py-3 px-3">{!closed && <input type="checkbox" checked={sel.has(j.id)} onChange={() => toggleSel(j.id)} aria-label={`Select ${j.reg}`} />}</td>
                    <td className="py-3 px-3 align-top">
                      <SourceBadge route={r}>{j.source_raw && j.source_raw !== 'Not found' ? j.source_raw : ROUTES[r].split(' (')[0]}</SourceBadge>
                      <div className="text-[10px] text-slate-500 mt-1">{j.initiated_by ? `by ${j.initiated_by}` : 'initiator not recorded'}</div>
                      {r === 'unresolved' && (
                        <select className={`${field} !py-1 mt-1`} value="" onChange={(e) => e.target.value && act(() => api('POST', `/api/pending-approvals/jobs/${encodeURIComponent(j.id)}/route`, { route: e.target.value }))}>
                          <option value="">Set source…</option>
                          {Object.entries(ROUTES).filter(([k]) => k !== 'unresolved').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="py-3 px-3 align-top"><b>{j.reg}</b><div className="text-[10px] text-slate-500">#{j.id} · {j.policy_holder}</div></td>
                    <td className="py-3 px-3 align-top whitespace-nowrap">{fmtD(j.val_date)}<div className="mt-1"><Pill tone={age >= 5 ? 'bad' : age >= 3 ? 'warn' : 'mute'}>{age}d old</Pill></div></td>
                    <td className="py-3 px-3 align-top">{j.insurer}</td>
                    <td className={`py-3 px-3 align-top ${r === 'solver' ? 'bg-rose-50/50' : ''}`}>
                      {r !== 'solver' ? <span className="text-slate-400">-</span> : (
                        <>
                          <b>{j.solver}</b>
                          <div>{sp.phone || j.solver_phone ? (sp.phone || j.solver_phone) : <Pill tone="bad">no phone</Pill>}</div>
                          <div className="text-[10px] text-slate-500">{solverEmailOf(ctx.solvers, j) || 'no email on file'}</div>
                          {bc && <div className="text-[10px] text-slate-500">Broker/agent: {bc.contact}</div>}
                        </>
                      )}
                    </td>
                    <td className="py-3 px-3 align-top">{j.allocated_to}</td>
                    <td className="py-3 px-3 align-top"><Pill tone="warn">{DOC_NEEDED[j.reason] || j.reason}</Pill>{j.comment && <div className="text-[10px] text-slate-500 mt-1 max-w-[200px]">{j.comment}</div>}</td>
                    <td className="py-3 px-3 align-top text-right"><b>{nAtt(j)}</b><div className="text-[10px] text-slate-500">{calls(j)} call · {mails(j)} email{msgs(j) ? ` · ${msgs(j)} text` : ''}</div>{l && <div className="text-[10px] text-slate-500">last {fmtDT(l.at)}</div>}</td>
                    <td className="py-3 px-3 align-top">
                      {closed ? <Pill tone="ok">{j.closed_via === 'export' ? 'Approved' : 'Closed'} {fmtD(j.closed_at)}</Pill> : (
                        <>
                          <Pill tone={toneOf(lab[1])}>{lab[0]}</Pill>
                          <div className="text-[10px] text-slate-500 mt-1">Next: {ns.t}{act1 === 'nonact' || r === 'unresolved' ? '' : r === 'solver' ? ' (phone)' : ' (email)'}</div>
                          {act1 === 'nonact' && <button type="button" className={`${btn} ${btnSm} mt-1`} onClick={() => act(() => api('POST', `/api/pending-approvals/jobs/${encodeURIComponent(j.id)}/reactivate`))}>Reactivate</button>}
                        </>
                      )}
                    </td>
                    <td className="py-3 px-3 align-top">
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        {!closed && <button type="button" className={`${btn} ${btnSm}`} onClick={() => setDialog({ t: 'log', id: j.id })}>Log outcome</button>}
                        {!closed && r === 'ref' && <button type="button" className={`${btn} ${btnSm}`} onClick={() => openAm(j.initiated_by || 'Unknown', open)}>Email</button>}
                        {!closed && r === 'cp' && <button type="button" className={`${btn} ${btnSm}`} onClick={() => openIns(j.insurer || 'Unknown', open)}>Email</button>}
                        {!closed && <button type="button" className={`${btnOk} ${btnSm}`} onClick={() => setDialog({ t: 'received', ids: [j.id] })}>Received</button>}
                        <button type="button" className={`${btn} ${btnSm}`} onClick={() => toggleHist(j.id)}>History</button>
                      </div>
                    </td>
                  </tr>
                  {openHist.has(j.id) && (
                    <tr>
                      <td></td>
                      <td colSpan={10} className="px-3 pb-3 text-[11px] text-slate-600 bg-slate-50/60">
                        {attemptsOf(j).length ? (
                          <ol className="list-decimal pl-5 space-y-0.5 pt-2">
                            {attemptsOf(j).map((a, i) => (
                              <li key={i}>{fmtDT(a.at)} · {a.by} · {a.type}{a.party && a.party !== '-' ? ` to ${a.party}` : ''} · {outText(a)}{a.contact ? ` (${a.contact})` : ''}{a.note ? ` · ${a.note}` : ''}</li>
                            ))}
                          </ol>
                        ) : <span className="block pt-2">No attempts yet.</span>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {!list.length && <p className="text-xs text-slate-500 p-4">No jobs match.</p>}
      </div>

      {dialog?.t === 'log' && dialogJob && <LogOutcomeModal job={dialogJob} shared={shared} onClose={() => setDialog(null)} />}
      {dialog?.t === 'compose' && <ComposeModal kind={dialog.kind} keyName={dialog.key} list={dialog.list} shared={shared} onClose={() => setDialog(null)} />}
      {dialog?.t === 'received' && <ReceivedModal ids={dialog.ids} shared={shared} onClose={() => setDialog(null)} onDone={() => setSel(new Set())} />}
    </div>
  );
}
