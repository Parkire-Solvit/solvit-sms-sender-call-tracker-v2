// V15 src/components/AgentKpiPanel.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Target, RefreshCw, ChevronDown, Phone, MessageSquare, AlertTriangle, CheckCircle2, Gauge } from 'lucide-react';

export interface AgentKpiPace {
  calls_today: number;
  working_hours_today: number;
  calls_per_hour_today: number | null;
  calls_lookback: number;
  working_hours_lookback: number;
  calls_per_hour_average: number | null;
  hours_to_clear: number | null;
  projected_finish_at: string | null;
  advice: string[];
}

export interface AgentKpiRow {
  agent_id: number;
  agent_name: string;
  in_scope: number;
  completed: number;
  open: number;
  closed_by_upload: number;
  completion_rate: number | null;
  all_clear: boolean;
  never_contacted: number;
  below_target: number;
  at_target_open: number;
  open_customers: number;
  calls_remaining: number;
  sms_remaining: number;
  oldest_open_days: number | null;
  pace: AgentKpiPace;
}

export interface AgentKpiReportData {
  section: 'callbacks' | 'pending_submissions';
  generated_at: string;
  window_days: number;
  pace_lookback_working_days: number;
  requirements: { calls: number; sms: number };
  upload_closed_label: string;
  unassigned_open: number;
  agents: AgentKpiRow[];
}

interface AgentKpiPanelProps {
  section: 'callbacks' | 'pending_submissions';
  /** Highlights and lists first the agent currently selected on the screen (by id or by name). */
  focusAgentId?: number | null;
  focusAgentName?: string | null;
  /** Increase this number to make the panel reload (for example after a list refresh). */
  refreshToken?: number;
  /** Pending Submissions only: show the KPI of one job type (a Pending Inspection or a Pending Submission). */
  jobType?: 'INSPECTION' | 'SUBMISSION';
}

const SECTION_TITLE: Record<AgentKpiPanelProps['section'], string> = {
  callbacks: 'Callbacks',
  pending_submissions: 'Pending Submissions',
};

export default function AgentKpiPanel({ section, focusAgentId = null, focusAgentName = null, refreshToken = 0, jobType }: AgentKpiPanelProps) {
  const [report, setReport] = useState<AgentKpiReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(true);

  const basePath = section === 'callbacks' ? '/api/agent-kpi/callbacks' : '/api/agent-kpi/pending-submissions';
  const path = section === 'pending_submissions' && jobType ? `${basePath}?job_type=${jobType}` : basePath;
  const title =
    section === 'pending_submissions' && jobType
      ? jobType === 'SUBMISSION'
        ? 'Pending Submission'
        : 'Pending Inspection'
      : SECTION_TITLE[section];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(path);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load the KPI (${res.status})`);
      }
      setReport(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load the KPI.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // Refresh every 5 minutes while the panel is on screen
  useEffect(() => {
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  const rows = useMemo(() => {
    if (!report) return [];
    const isFocus = (r: AgentKpiRow) =>
      (focusAgentId !== null && focusAgentId !== undefined && r.agent_id === focusAgentId) ||
      (!!focusAgentName && r.agent_name.trim().toLowerCase() === focusAgentName.trim().toLowerCase());
    return [...report.agents].sort((a, b) => Number(isFocus(b)) - Number(isFocus(a)) || a.agent_name.localeCompare(b.agent_name));
  }, [report, focusAgentId, focusAgentName]);

  const isFocusRow = (r: AgentKpiRow) =>
    (focusAgentId !== null && focusAgentId !== undefined && r.agent_id === focusAgentId) ||
    (!!focusAgentName && r.agent_name.trim().toLowerCase() === focusAgentName.trim().toLowerCase());

  return (
    <div id={`agent-kpi-panel-${section}`} className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2.5 text-left cursor-pointer"
          aria-expanded={expanded}
        >
          <div className="w-8 h-8 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center flex-shrink-0">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 leading-tight">Agent Completion KPI: {title}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Success means every record is contacted to the maximum ({report ? `${report.requirements.calls} calls and ${report.requirements.sms} SMS` : 'calls and SMS'}) or closed.
            </p>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all shadow-2xs cursor-pointer disabled:opacity-50"
          title="Refresh the KPI"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#ff353e]' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">{error}</div>
          )}

          {!report && loading && <div className="py-6 text-center text-xs text-slate-400">Loading the KPI...</div>}

          {report && rows.length === 0 && (
            <div className="py-6 text-center text-xs text-slate-400">No active agents are tagged to this team.</div>
          )}

          {report && report.unassigned_open > 0 && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
              <span>
                <span className="font-bold">{report.unassigned_open}</span> open record{report.unassigned_open === 1 ? '' : 's'} belong to no active agent, so they are in nobody's KPI until they are assigned.
              </span>
            </div>
          )}

          {report && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rows.map((r) => (
                <div
                  key={r.agent_id}
                  className={`rounded-2xl border p-4 space-y-3 ${isFocusRow(r) ? 'border-[#ff353e]/40 bg-red-50/30' : 'border-slate-200 bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900">{r.agent_name}</span>
                        {r.all_clear && r.in_scope > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-3 h-3" /> All clear
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {r.completed} completed of {r.in_scope} in scope &bull; {r.open} open
                        {r.closed_by_upload > 0 && <> &bull; {r.closed_by_upload} {report.upload_closed_label.toLowerCase()}</>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-slate-900 leading-none">
                        {r.completion_rate === null ? 'n/a' : `${r.completion_rate}%`}
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">Completion</div>
                    </div>
                  </div>

                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${r.all_clear ? 'bg-emerald-500' : 'bg-gradient-to-r from-red-500 to-[#ff353e]'}`}
                      style={{ width: `${Math.max(0, Math.min(100, r.completion_rate ?? 0))}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                    <span className={`px-2 py-0.5 rounded-md border ${r.never_contacted > 0 ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                      Never contacted: {r.never_contacted}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md border ${r.below_target > 0 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                      In progress: {r.below_target}
                    </span>
                    {r.at_target_open > 0 && (
                      <span className="px-2 py-0.5 rounded-md border bg-slate-50 text-slate-600 border-slate-200">At maximum, closing: {r.at_target_open}</span>
                    )}
                    <span className="px-2 py-0.5 rounded-md border bg-slate-50 text-slate-700 border-slate-200 inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {r.calls_remaining} calls left
                    </span>
                    <span className="px-2 py-0.5 rounded-md border bg-slate-50 text-slate-700 border-slate-200 inline-flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> {r.sms_remaining} SMS left
                    </span>
                    {r.oldest_open_days !== null && (
                      <span className="px-2 py-0.5 rounded-md border bg-slate-50 text-slate-700 border-slate-200">
                        Oldest open: {r.oldest_open_days} {r.oldest_open_days === 1 ? 'day' : 'days'}
                      </span>
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
                      <Gauge className="w-3.5 h-3.5" /> Pace advice
                      <span className="font-semibold normal-case tracking-normal text-slate-400">
                        {r.pace.calls_per_hour_average !== null ? `(${r.pace.calls_per_hour_average} calls/hour average` : '(rate not available'}
                        {r.pace.calls_per_hour_today !== null ? `, ${r.pace.calls_per_hour_today} today)` : ')'}
                      </span>
                    </div>
                    {r.pace.advice.map((line, i) => (
                      <p key={i} className={`text-xs leading-relaxed ${i === 0 ? 'text-slate-800 font-semibold' : 'text-slate-600'}`}>
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {report && (
            <p className="text-[10px] text-slate-400">
              Counts records that are open now or were closed in the last {report.window_days} days. Records closed because an upload no longer contained them are shown separately as {report.upload_closed_label.toLowerCase()} and do not count as completed. Rates use outgoing calls over the last {report.pace_lookback_working_days} working days.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
// V15 END src/components/AgentKpiPanel.tsx
