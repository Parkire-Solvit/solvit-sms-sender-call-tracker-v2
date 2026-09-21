import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { EmailReport } from '../../server/email/emailReportService';
import { emailDurationLabel } from '../../shared/emailDurationLabel';
import { emailCompletionTime } from '../../shared/emailCompletionLabel';

const today = () => new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const percent = (value: number | null) => value === null ? 'Not assessed' : `${value.toFixed(1)}%`;
export function EmailSlaReports({ employeeEmail, members, refreshToken }: { employeeEmail?: string; members: {email:string;display_name:string}[]; refreshToken: number }) {
  const [kind,setKind] = useState('weekly');
  const [anchor,setAnchor] = useState(today);
  const [end,setEnd] = useState(today);
  const [owner,setOwner] = useState('');
  const [report,setReport] = useState<EmailReport | null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [exporting,setExporting] = useState(false);
  const query = new URLSearchParams({kind,anchor,...(kind === 'custom' ? {end} : {}),...(!employeeEmail && owner ? {owner} : {})}).toString();
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setReport(null); setError('');
    fetch(`/api/email/reports?${query}`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Report could not be generated');
      if (!controller.signal.aborted) setReport(data);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  },[query,refreshToken]);
  async function download() {
    setExporting(true);
    try {
      const response = await fetch(`/api/email/reports/export?${query}`);
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Export failed'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href=url; link.download=`email-sla-${kind}-${anchor}.xlsx`; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch(cause) { setError((cause as Error).message); }
    finally { setExporting(false); }
  }
  const input = 'rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white';
  return <section className="space-y-5">
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div><h3 className="font-semibold text-lg">{employeeEmail ? 'My SLA report' : 'Team SLA reports'}</h3>
        <p className="text-sm text-slate-500 mt-1">Nairobi dates · SLA time counts Mon–Fri, 08:00–17:00, excluding configured holidays.</p></div>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-slate-600 space-y-1">Period<select className={`${input} block`} value={kind} onChange={e => setKind(e.target.value)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom dates</option></select></label>
        <label className="text-xs text-slate-600 space-y-1">{kind === 'custom' ? 'Start date' : 'Date in week / month'}<input className={`${input} block`} type="date" max={today()} value={anchor} onChange={e => setAnchor(e.target.value)} /></label>
        {kind === 'custom' && <label className="text-xs text-slate-600 space-y-1">End date<input className={`${input} block`} type="date" min={anchor} value={end} onChange={e => setEnd(e.target.value)} /></label>}
        {!employeeEmail && <label className="text-xs text-slate-600 space-y-1">Owner<select className={`${input} block`} value={owner} onChange={e => setOwner(e.target.value)}><option value="">All owners</option>{members.map(m => <option key={m.email} value={m.email}>{m.display_name}</option>)}</select></label>}
        <button disabled={!report || busy || exporting} onClick={() => void download()} className="rounded-lg border border-blue-200 text-blue-700 px-3 py-2 text-sm flex items-center gap-2 disabled:opacity-50"><Download size={16}/>{exporting ? 'Exporting…' : 'Export Excel'}</button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 text-red-700 p-3 text-sm">{error}</p>}
    {busy && <p role="status" className="text-sm text-slate-500">Generating report…</p>}
    {report && <>
      <p className="text-xs text-slate-500">Period starts {emailCompletionTime(report.period.start)} · Results as of {emailCompletionTime(report.summary.asOf)}. Current periods are partial snapshots.</p>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">{[['Tickets received',report.summary.received],['Response SLA',percent(report.summary.response.compliancePercent)],['Older backlog open',report.summary.olderBacklogStillOpen]].map(([label,value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-semibold mt-2">{value}</p></div>)}</div>
      {(() => { const s=report.summary.response; return <div className="rounded-xl border bg-white p-5"><h4 className="font-semibold">Response outcomes</h4><dl className="grid grid-cols-2 gap-3 text-sm mt-3">{[['On time',s.met],['Responded late',s.completedLate],['Overdue & open',s.overdueOpen],['Within deadline',s.pendingWithinDeadline]].map(([k,v]) => <div key={k}><dt className="text-slate-500 text-xs">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl><p className="text-xs text-slate-500 mt-3">Median response time: {s.medianWorkingMinutes === null ? '—' : emailDurationLabel(s.medianWorkingMinutes)}.</p></div>; })()}
      <div className="rounded-xl border bg-white p-5 space-y-3"><h4 className="font-semibold">Owner breakdown</h4>
        <p className="text-xs text-slate-500">{report.attribution}</p>
        {report.unknownOwnership && <p className="text-xs text-amber-700">Some emails have unknown ownership. They remain in team totals, but are not credited to a named owner.</p>}
        {report.owners.map(o => <div key={o.email} className="grid sm:grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm"><div className="font-semibold break-words">{o.name}</div><div><span className="text-xs text-slate-500 block">Assigned tickets</span>{o.received}</div><div><span className="text-xs text-slate-500 block">Response SLA</span>{percent(o.response.compliancePercent)} · {o.response.completedLate} late</div></div>)}
      </div>
      <div className="rounded-xl border bg-white p-5 space-y-3"><h4 className="font-semibold">Open overdue stages ({report.overdue.length})</h4><p className="text-xs text-slate-500">Includes older backlog, listed separately from received-period SLA percentages. Showing up to 50; Excel includes all.</p>
        {!report.overdue.length && <p className="text-sm text-slate-500">No open overdue stages.</p>}
        {report.overdue.slice(0,50).map(r => <div key={`${r.id}-${r.stage}`} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"><div className="min-w-0 flex-1"><p className="font-medium break-words">{r.subject}</p><p className="text-xs text-slate-500">#{r.id} · {r.owner} · {r.stage}{r.olderBacklog ? ' · Older backlog' : ''}</p></div><span className="text-red-700 text-sm">{emailDurationLabel(r.overdueWorkingMinutes)} overdue</span></div>)}
      </div>
    </>}
  </section>;
}
