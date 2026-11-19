// src/components/PendingOverallDashboard.tsx
// Overall KPI dashboard for Pending Submissions: every job, Pending Inspection and Pending Submission together,
// because ultimately they are all pending submissions. Read only, admins only. Follows the section's date range.
import React, { useMemo } from 'react';
import { BarChart3, CheckCircle2, Clock, AlertTriangle, Send, XCircle, Target, Percent, Repeat } from 'lucide-react';
import AgentKpiPanel from './AgentKpiPanel';
import { PendingPerformanceSummary, summarizePendingPerformance, PerformanceJob } from '../../shared/pendingPerformance';

interface OverallJob extends PerformanceJob {
  job_type: 'INSPECTION' | 'SUBMISSION';
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  insurance_company: string | null;
}

interface PendingOverallDashboardProps {
  /** Every job of both types inside the date range. */
  jobs: OverallJob[];
  overdueAfterDays: number;
  rangeLabel: string;
  dateParams: Record<string, string>;
  refreshToken: number;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${v}%`);
const avg = (v: number | null) => (v === null ? 'n/a' : String(v));

function groupSummaries<T extends OverallJob>(jobs: T[], keyOf: (j: T) => string): Array<{ key: string; summary: PendingPerformanceSummary }> {
  const groups = new Map<string, T[]>();
  for (const j of jobs) {
    const key = keyOf(j);
    const list = groups.get(key) ?? [];
    list.push(j);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, summary: summarizePendingPerformance(list) }))
    .sort((a, b) => b.summary.total - a.summary.total || a.key.localeCompare(b.key));
}

function Tile({ label, value, sub, tone, icon }: { label: string; value: string | number; sub?: string; tone: string; icon: React.ReactNode }) {
  return (
    <div className={`p-4 rounded-2xl border bg-white ${tone}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider block opacity-80">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <span className="text-2xl font-black mt-1 block">{value}</span>
      {sub && <span className="text-[10px] font-semibold opacity-70 block mt-0.5">{sub}</span>}
    </div>
  );
}

function BreakdownTable({ title, firstColumn, rows, total }: { title: string; firstColumn: string; rows: Array<{ key: string; summary: PendingPerformanceSummary }>; total?: PendingPerformanceSummary }) {
  const cells = (s: PendingPerformanceSummary) => [
    s.total,
    s.open,
    s.agent_converted,
    s.closed_by_upload,
    s.closed_unsuccessful,
    pct(s.agent_conversion_rate),
    pct(s.closure_rate),
    avg(s.avg_calls_per_conversion),
    avg(s.avg_sms_per_conversion),
  ];
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left font-bold px-4 py-2">{firstColumn}</th>
              <th className="text-right font-bold px-3 py-2">Total</th>
              <th className="text-right font-bold px-3 py-2">Open</th>
              <th className="text-right font-bold px-3 py-2">Converted by agent</th>
              <th className="text-right font-bold px-3 py-2">Closed by upload</th>
              <th className="text-right font-bold px-3 py-2">Unsuccessful</th>
              <th className="text-right font-bold px-3 py-2">Agent conversion</th>
              <th className="text-right font-bold px-3 py-2">Closure rate</th>
              <th className="text-right font-bold px-3 py-2">Avg calls / conversion</th>
              <th className="text-right font-bold px-3 py-2">Avg SMS / conversion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">No jobs in this range.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key} className="text-slate-700">
                <td className="px-4 py-2 font-bold text-slate-900">{r.key}</td>
                {cells(r.summary).map((c, i) => (
                  <td key={i} className="px-3 py-2 text-right font-mono">{c}</td>
                ))}
              </tr>
            ))}
            {total && rows.length > 0 && (
              <tr className="bg-slate-50 font-black text-slate-900">
                <td className="px-4 py-2">Overall</td>
                {cells(total).map((c, i) => (
                  <td key={i} className="px-3 py-2 text-right font-mono">{c}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PendingOverallDashboard({ jobs, overdueAfterDays, rangeLabel, dateParams, refreshToken }: PendingOverallDashboardProps) {
  const overall = useMemo(() => summarizePendingPerformance(jobs), [jobs]);
  const byType = useMemo(
    () => groupSummaries(jobs, (j) => (j.job_type === 'SUBMISSION' ? 'Pending Submission' : 'Pending Inspection')),
    [jobs]
  );
  const byAgent = useMemo(() => groupSummaries(jobs, (j) => j.assigned_agent_name || 'Unassigned'), [jobs]);
  const byCompany = useMemo(() => groupSummaries(jobs, (j) => j.insurance_company?.trim() || 'Unspecified'), [jobs]);

  return (
    <div className="space-y-6" id="pending-overall-dashboard">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center flex-shrink-0">
          <BarChart3 className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-sm font-black text-slate-900">Overall performance: Pending Inspection and Pending Submission</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Every job, whichever stage it is in. A job that moved from inspection to submission is one record and is counted once. {rangeLabel}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <Tile label="Total Jobs" value={overall.total} tone="border-slate-200/80 text-slate-800" icon={<BarChart3 className="w-4 h-4" />} />
        <Tile label="Open (Amber)" value={overall.open} tone="border-slate-200/80 text-amber-700" icon={<Clock className="w-4 h-4" />} />
        <Tile label={`Overdue (>${overdueAfterDays}d)`} value={overall.overdue} tone="border-slate-200/80 text-rose-700" icon={<AlertTriangle className="w-4 h-4" />} />
        <Tile label="Converted by Agent" value={overall.agent_converted} sub="Scheduled or submitted" tone="border-slate-200/80 text-emerald-700" icon={<CheckCircle2 className="w-4 h-4" />} />
        <Tile label="Closed by Upload" value={overall.closed_by_upload} tone="border-slate-200/80 text-sky-700" icon={<Send className="w-4 h-4" />} />
        <Tile label="Closed Unsuccessful" value={overall.closed_unsuccessful} sub={`${overall.max_attempts} at max attempts`} tone="border-slate-200/80 text-slate-700" icon={<XCircle className="w-4 h-4" />} />
        <Tile
          label="Agent Conversion Rate"
          value={pct(overall.agent_conversion_rate)}
          sub={`${overall.agent_converted} of ${overall.total} converted by an agent`}
          tone="bg-emerald-50 border-emerald-200 text-emerald-800"
          icon={<Target className="w-4 h-4" />}
        />
        <Tile
          label="Closure Rate"
          value={pct(overall.closure_rate)}
          sub={`${overall.closed} of ${overall.total} closed, incl. by upload`}
          tone="bg-sky-50 border-sky-200 text-sky-800"
          icon={<Percent className="w-4 h-4" />}
        />
        <Tile
          label="Avg Calls / Conversion"
          value={avg(overall.avg_calls_per_conversion)}
          sub="Counted calls per converted job"
          tone="border-slate-200/80 text-slate-800"
          icon={<Repeat className="w-4 h-4" />}
        />
        <Tile
          label="Avg SMS / Conversion"
          value={avg(overall.avg_sms_per_conversion)}
          sub={`Calls + SMS: ${avg(overall.avg_attempts_per_conversion)}`}
          tone="border-slate-200/80 text-slate-800"
          icon={<Repeat className="w-4 h-4" />}
        />
      </div>

      <BreakdownTable title="By job type" firstColumn="Job type" rows={byType} total={overall} />
      <BreakdownTable title="By agent" firstColumn="Agent" rows={byAgent} total={overall} />
      <BreakdownTable title="By insurance company" firstColumn="Insurance company" rows={byCompany} total={overall} />

      <AgentKpiPanel section="pending_submissions" dateParams={dateParams} refreshToken={refreshToken} />

      <p className="text-[10px] text-slate-400">
        Agent conversion rate: jobs an agent closed as Scheduled (inspection) or Submitted (submission), divided by all jobs. Jobs closed
        because an upload no longer contained them are not conversions. Closure rate: every closed job (converted, closed by upload,
        withdrawn, max attempts) divided by all jobs. Attempt averages use counted calls and SMS; a job that moved to submission restarts
        its count at that point.
      </p>
    </div>
  );
}
