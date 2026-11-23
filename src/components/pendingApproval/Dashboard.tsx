// Pending Approval: the KPI dashboard. Conversion against the target, where jobs are stuck, who is following up, and the
// full Segment 1 / Segment 2 tables the section's manager asked for, with an Excel download.
import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { NONACT_AT, computeApprovalReport, nairobiYmd, pct, type ReportGrain } from '../../../shared/pendingApproval';
import { api, downloadBlob, XLSX_TYPE, type Shared } from './api';
import { Panel, Tile, btnPrimary, field, th } from './ui';

const percent = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** Horizontal bars: one row per item, the bar is its share of the largest value. */
function BarRows({ rows, tone = 'bg-[#ff353e]', format = (v: number) => String(v) }: { rows: Array<{ label: string; value: number; sub?: string }>; tone?: string; format?: (v: number) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-[11px] text-slate-500">No data for this selection.</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(110px,200px)_1fr_auto] items-center gap-2 text-[11px]">
          <span className="truncate text-slate-700 font-semibold" title={r.label}>{r.label}</span>
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
          <span className="font-mono font-bold text-slate-800 whitespace-nowrap">{format(r.value)}{r.sub && <span className="font-sans font-semibold text-slate-400"> {r.sub}</span>}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical bars, 0 to 100 percent, with the target drawn across them. */
function ConversionChart({ periods, target }: { periods: Array<{ label: string; followed: number; approved: number; conversion: number }>; target: number }) {
  if (!periods.length) return <p className="text-[11px] text-slate-500">No followed-up jobs for this selection.</p>;
  return (
    <div>
      <div className="relative h-44 flex items-end gap-2 border-b border-l border-slate-200 px-2">
        <div className="absolute left-0 right-0 border-t-2 border-dashed border-emerald-500/70" style={{ bottom: `${target * 100}%` }} aria-hidden />
        <span className="absolute right-1 text-[10px] font-bold text-emerald-700 bg-white/80 px-1 rounded" style={{ bottom: `calc(${target * 100}% + 2px)` }}>Target {Math.round(target * 100)}%</span>
        {periods.map((p) => (
          <div key={p.label} className="flex-1 min-w-[28px] h-full flex flex-col justify-end items-center" title={`${p.label}: ${p.approved} approved of ${p.followed} followed up (${percent(p.conversion)})`}>
            <span className="text-[10px] font-mono font-bold text-slate-700 mb-0.5">{percent(p.conversion)}</span>
            <div className={`w-full rounded-t-md ${p.conversion >= target ? 'bg-emerald-500' : 'bg-[#ff353e]'}`} style={{ height: `${Math.max(1, p.conversion * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 px-2 mt-1">{periods.map((p) => <span key={p.label} className="flex-1 min-w-[28px] text-[9px] text-center text-slate-500 leading-tight">{p.label}</span>)}</div>
    </div>
  );
}

function StackedRows({ rows }: { rows: Array<{ label: string; pending: number; nonact: number; total: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  if (!rows.length) return <p className="text-[11px] text-slate-500">Every followed-up job in this selection was approved.</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(110px,220px)_1fr_auto] items-center gap-2 text-[11px]">
          <span className="truncate text-slate-700 font-semibold" title={r.label}>{r.label}</span>
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex" style={{ width: `${Math.max(4, (r.total / max) * 100)}%` }}>
            <div className="bg-amber-400 h-full" style={{ flex: r.pending }} title={`Still pending: ${r.pending}`} />
            <div className="bg-slate-500 h-full" style={{ flex: r.nonact }} title={`Non-actionable: ${r.nonact}`} />
          </div>
          <span className="font-mono font-bold text-slate-800">{r.total}</span>
        </div>
      ))}
      <div className="flex gap-4 text-[10px] text-slate-500 pt-1"><span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 mr-1" />Still pending</span><span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-500 mr-1" />Non-actionable</span></div>
    </div>
  );
}

export function Dashboard({ shared, targetConv }: { shared: Shared; targetConv: number }) {
  const { state, toast, reload } = shared;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [insurer, setInsurer] = useState('');
  const [grain, setGrain] = useState<ReportGrain>('week');
  const [targetInput, setTargetInput] = useState(String(Math.round(targetConv * 100)));
  const now = Date.now();
  const rep = useMemo(() => computeApprovalReport(state.jobs, { from, to, insurer, grain, target: targetConv, now, dir: state.directory }), [state.jobs, state.directory, from, to, insurer, grain, targetConv]); // eslint-disable-line react-hooks/exhaustive-deps
  const insurers = [...new Set(state.jobs.map((j) => j.insurer))].sort();
  const { F, A, P, NA, NOT, activity } = rep;
  const gap = Number(rep.gap);
  const maxDay = Math.max(1, ...activity.perDay.map((d) => d.n));

  const saveTarget = async () => {
    const v = Math.min(100, Math.max(0, Number(targetInput) || 0)) / 100;
    setTargetInput(String(Math.round(v * 100)));
    if (v === targetConv) return;
    try { await api('PUT', '/api/pending-approvals/settings', { target_conversion: v }); await reload(); } catch (e) { toast(`Target not saved: ${(e as Error).message}`, true); }
  };

  const download = () => {
    try {
      const wb = XLSX.utils.book_new();
      const names = ['Segment 1', 'Barriers', 'Document missing', 'By period', 'By reason', 'Segment 2', 'By source', 'By insurer'];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Pending jobs follow-up report'], ['Valuation dates', `${from || 'all'} to ${to || 'all'}`], ['Target conversion', `${Math.round(targetConv * 100)}%`], ['Conversion', pct(A.length, F.length)], ['Gap to target', `${rep.gap} pts`], [], ...rep.tables[0].rows]), 'Summary');
      rep.tables.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[t.t], t.head, ...t.rows]), names[i]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rep.notApprovedRows.length ? rep.notApprovedRows : [{ 'Request ID': '' }]), 'Followed up, not approved');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rep.notFollowedRows.length ? rep.notFollowedRows : [{ 'Request ID': '' }]), 'Not followed up');
      downloadBlob(`Pending_followup_report_${nairobiYmd(now)}.xlsx`, new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: XLSX_TYPE }));
    } catch (e) { toast(`Report not saved: ${(e as Error).message}`, true); }
  };

  const detail = (title: string, rows: Array<Record<string, string | number>>) => (
    <details className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
      <summary className="text-sm font-black text-slate-900 cursor-pointer">{title} ({rows.length})</summary>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-left border-collapse text-xs min-w-[700px]">
          <thead><tr className="bg-slate-50 border-b border-slate-200/80">{Object.keys(rows[0] || { '-': 0 }).map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r, i) => <tr key={i}>{Object.values(r).map((v, k) => <td key={k} className="py-2 px-3">{String(v)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-3 shadow-xs flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">Valuation from <input type="date" className={`${field} !w-auto`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">to <input type="date" className={`${field} !w-auto`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select className={`${field} !w-auto`} aria-label="Insurance company" value={insurer} onChange={(e) => setInsurer(e.target.value)}><option value="">All insurance companies</option>{insurers.map((r) => <option key={r}>{r}</option>)}</select>
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">Group periods by
          <select className={`${field} !w-auto`} value={grain} onChange={(e) => setGrain(e.target.value as ReportGrain)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select>
        </label>
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">Target conversion %
          <input type="number" min={0} max={100} step={1} className={`${field} !w-20`} value={targetInput} onChange={(e) => setTargetInput(e.target.value)} onBlur={saveTarget} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </label>
        <span className="flex-1" />
        <button type="button" className={btnPrimary} onClick={download}><Download className="w-3.5 h-3.5" />Download report as Excel</button>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">A job counts as followed up once a call, text or email is logged for it. Approved means the document was received or the job dropped off the pending list. A job with {NONACT_AT} or more follow-ups and no approval is non-actionable.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <Tile value={pct(A.length, F.length)} label="Conversion" sub={`${A.length} approved of ${F.length} followed up`} tone="bg-emerald-50 border-emerald-200 text-emerald-800" />
        <Tile value={`${Math.round(targetConv * 100)}%`} label="Target" sub="Change it above" />
        <Tile value={`${gap > 0 ? '+' : ''}${rep.gap} pts`} label="Gap to target" tone={gap >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'} />
        <Tile value={rep.info.length} label="Pipeline" sub="Pending approval, in this selection" />
        <Tile value={F.length} label="Followed up" />
        <Tile value={P.length} label="Still pending" tone="border-slate-200/80 text-amber-700" sub="Followed up, actionable" />
        <Tile value={NA.length} label="Non-actionable" tone="border-slate-200/80 text-slate-600" sub={`${NONACT_AT}+ follow-ups`} />
        <Tile value={rep.N.length} label="Not followed up" tone="border-slate-200/80 text-rose-700" sub="Segment 2" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Conversion by follow-up period" how={`By date of first follow-up, grouped by ${grain}. Green bars met the target.`}><ConversionChart periods={rep.periods} target={targetConv} /></Panel>
        <Panel title="Why followed-up jobs are not approved" how="What happened at the latest follow-up."><StackedRows rows={rep.barriers} /></Panel>
        <Panel title="Conversion by source" how="Share of followed-up jobs that were approved."><BarRows rows={rep.bySource.map((s) => ({ label: s.label, value: s.conversion, sub: `${s.approved}/${s.followed}` }))} tone="bg-sky-500" format={percent} /></Panel>
        <Panel title="Conversion by insurance company" how="Share of followed-up jobs that were approved."><BarRows rows={rep.byInsurer.filter((s) => s.followed > 0).map((s) => ({ label: s.label, value: s.conversion, sub: `${s.approved}/${s.followed}` }))} tone="bg-teal-500" format={percent} /></Panel>
        <Panel title="Document missing, not approved"><StackedRows rows={rep.docMissing} /></Panel>
        <Panel title="Follow-ups per day, last 14 days" how={`${activity.total} logged: ${activity.calls} calls, ${activity.emails} emails, ${activity.texts} texts.`}>
          <div className="flex items-end gap-1.5 h-32 border-b border-slate-200">
            {activity.perDay.map((d) => (
              <div key={d.ymd} className="flex-1 h-full flex flex-col justify-end items-center" title={`${d.ymd}: ${d.n}`}>
                <span className="text-[9px] font-mono text-slate-600">{d.n || ''}</span>
                <div className="w-full rounded-t bg-[#ff353e]/80" style={{ height: `${(d.n / maxDay) * 100}%`, minHeight: d.n ? 2 : 0 }} />
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 mt-1">{activity.perDay.map((d) => <span key={d.ymd} className="flex-1 text-[9px] text-center text-slate-500">{d.day}</span>)}</div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile value={activity.avgFollowUpsBeforeApproval.toFixed(1)} label="Avg follow-ups before approval" />
        <Tile value={activity.avgDaysValuationToApproval.toFixed(1)} label="Avg days, valuation to approval" />
        <Tile value={activity.avgDaysValuationToFirst.toFixed(1)} label="Avg days, valuation to first follow-up" />
        <Tile value={NOT.length} label="Followed up, not approved" tone="border-slate-200/80 text-rose-700" />
      </div>

      <Panel title="Team activity" how="Follow-ups logged, and jobs closed as document received, by each person in this selection.">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[520px]">
            <thead><tr className="bg-slate-50 border-b border-slate-200/80"><th className={th}>Person</th><th className={`${th} text-right`}>Follow-ups</th><th className={`${th} text-right`}>Calls</th><th className={`${th} text-right`}>Emails</th><th className={`${th} text-right`}>Texts</th><th className={`${th} text-right`}>Closed (received)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rep.team.map((p) => <tr key={p.name}><td className="py-2 px-3 font-semibold">{p.name}</td><td className="py-2 px-3 text-right">{p.followUps}</td><td className="py-2 px-3 text-right">{p.calls}</td><td className="py-2 px-3 text-right">{p.emails}</td><td className="py-2 px-3 text-right">{p.texts}</td><td className="py-2 px-3 text-right">{p.closed}</td></tr>)}
              {!rep.team.length && <tr><td colSpan={6} className="py-3 px-3 text-slate-500">No follow-ups logged in this selection.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      {rep.tables.map((t) => (
        <React.Fragment key={t.t}>
        <Panel title={t.t}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[420px]">
              <thead><tr className="bg-slate-50 border-b border-slate-200/80">{t.head.map((h, i) => <th key={h} className={`${th} ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {t.rows.map((r, ri) => <tr key={ri} className={t.total && ri === t.rows.length - 1 ? 'font-bold bg-slate-50' : ''}>{r.map((c, i) => <td key={i} className={`py-2 px-3 ${i ? 'text-right' : ''}`}>{String(c)}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </Panel>
        </React.Fragment>
      ))}
      {detail('Followed-up jobs not approved', rep.notApprovedRows)}
      {detail('Jobs not followed up', rep.notFollowedRows)}
    </div>
  );
}
