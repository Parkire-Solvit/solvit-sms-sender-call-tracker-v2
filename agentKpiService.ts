// V15 agentKpiService.ts
// Loads the data for the per-agent completeness KPI and pace advisor, one report per section.
import { DbAdapter } from "./db";
import { getSystemSettings } from "./settingsManager";
import {
  AgentKpi,
  AgentPace,
  KPI_WINDOW_DAYS,
  KpiRecord,
  PACE_LOOKBACK_WORKING_DAYS,
  computeAgentKpis,
  computeAgentPace,
  lookbackStartMs,
} from "./agentKpi";
import {
  COUNTED_CALL_STATUSES,
  closeMaturedCallbackJobs,
  computeCallbackJobsActivity,
  getCallbackSettings,
  getValidCallbackAgents,
} from "./insuranceCallbacks";
import {
  closeMaturedPendingSubmissions,
  computePendingSubmissionActivity,
  getPendingSubmissionSettings,
  getValidSubmissionAgents,
  parseDbTimestamp,
  primaryPhoneOf,
} from "./pendingSubmissions";
import { ABSENT_CLOSE_OUTCOMES, PendingJobType, normalizeJobType } from "./pendingSubmissionOutcomes";

const DAY_MS = 86_400_000;

export type KpiSection = "callbacks" | "pending_submissions";

export interface AgentKpiReport {
  section: KpiSection;
  generated_at: string;
  window_days: number;
  pace_lookback_working_days: number;
  requirements: { calls: number; sms: number };
  /** Label for records closed because an upload no longer contained them. */
  upload_closed_label: string;
  unassigned_open: number;
  agents: Array<AgentKpi & { pace: AgentPace }>;
}

const num = (v: unknown): number => Number(v);
const dateOnly = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Counted outgoing call times (ms) per agent, from `sinceMs` onwards. */
async function loadCallTimes(db: DbAdapter, agentIds: number[], sinceMs: number): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  for (const id of agentIds) out.set(id, []);
  if (agentIds.length === 0) return out;
  const rows = await db.queryAll<{ agent_id: unknown; status: string | null; timestamp: unknown }>(
    `SELECT agent_id, status, timestamp FROM events
     WHERE agent_id IN (${agentIds.map(() => "?").join(", ")}) AND type = 'CALL' AND timestamp >= ?`,
    [...agentIds, dateOnly(sinceMs - DAY_MS)]
  );
  for (const r of rows) {
    if (!COUNTED_CALL_STATUSES.has(String(r.status ?? "").toUpperCase())) continue;
    const ms = parseDbTimestamp(r.timestamp);
    if (isNaN(ms) || ms < sinceMs) continue;
    out.get(num(r.agent_id))?.push(ms);
  }
  return out;
}

async function buildReport(
  db: DbAdapter,
  section: KpiSection,
  nowMs: number,
  agents: Array<{ id: number; name: string }>,
  records: KpiRecord[],
  req: { calls: number; sms: number },
  uploadClosedLabel: string
): Promise<AgentKpiReport> {
  const sys = await getSystemSettings(db);
  const kpi = computeAgentKpis(records, agents, req, nowMs);
  const lookStart = lookbackStartMs(nowMs, sys.working_hours_schedule, sys.clock_mode) ?? nowMs - 30 * DAY_MS;
  const callTimes = await loadCallTimes(db, agents.map((a) => a.id), lookStart);

  return {
    section,
    generated_at: new Date(nowMs).toISOString(),
    window_days: KPI_WINDOW_DAYS,
    pace_lookback_working_days: PACE_LOOKBACK_WORKING_DAYS,
    requirements: req,
    upload_closed_label: uploadClosedLabel,
    unassigned_open: kpi.unassigned_open,
    agents: kpi.agents.map((k) => ({
      ...k,
      pace: computeAgentPace({
        callTimesMs: callTimes.get(k.agent_id) ?? [],
        nowMs,
        schedule: sys.working_hours_schedule,
        clockMode: sys.clock_mode,
        calls_remaining: k.calls_remaining,
        sms_remaining: k.sms_remaining,
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Pending Submissions
// ---------------------------------------------------------------------------

/** With a job type, only that type's jobs are counted (the two tabs of Pending Submissions have their own KPI). */
export async function getPendingSubmissionAgentKpis(
  db: DbAdapter,
  nowMs: number = Date.now(),
  jobType?: PendingJobType
): Promise<AgentKpiReport> {
  await closeMaturedPendingSubmissions(db);
  const settings = await getPendingSubmissionSettings(db);
  const agents = await getValidSubmissionAgents(db, settings.callback_team_tag);
  const lowerBound = dateOnly(nowMs - (KPI_WINDOW_DAYS + 1) * DAY_MS);

  const rows = await db.queryAll<any>(
    `SELECT id, assigned_agent_id, client_phone, solver_contact, vehicle_reg, status, latest_outcome, closed_at, schedule_date, first_imported_at, job_type, type_changed_at
     FROM pending_submission_jobs
     WHERE status = 'AMBER' OR (closed_at IS NOT NULL AND closed_at >= ?)`,
    [lowerBound]
  );
  const jobs = rows
    .map((r) => ({ ...r, id: num(r.id), assigned_agent_id: r.assigned_agent_id === null || r.assigned_agent_id === undefined ? null : num(r.assigned_agent_id) }))
    .filter((j) => jobType === undefined || normalizeJobType(j.job_type) === jobType);
  const open = jobs.filter((j) => j.status === "AMBER");
  const activity = await computePendingSubmissionActivity(db, open);

  const records: KpiRecord[] = jobs.map((j) => {
    const act = activity.get(j.id);
    return {
      agent_id: j.assigned_agent_id,
      customer_key: primaryPhoneOf(j) || String(j.client_phone),
      status: j.status,
      closed_by_upload: j.status === "GREEN" && ABSENT_CLOSE_OUTCOMES.includes(j.latest_outcome ?? ""),
      closed_at: j.closed_at,
      reference_at: j.schedule_date,
      calls: act?.client_attempt_count ?? 0,
      sms: act?.client_sms_count ?? 0,
    };
  });

  return buildReport(db, "pending_submissions", nowMs, agents, records, { calls: settings.max_attempts, sms: settings.max_sms_attempts }, "Closed by upload");
}

// ---------------------------------------------------------------------------
// Insurance Job Callbacks
// ---------------------------------------------------------------------------

/** initiated_date may be "2026-10-01", "01/10/2026" or similar. Falls back to created_at. */
function callbackReferenceDate(initiated: unknown, created: unknown): string | null {
  const text = typeof initiated === "string" ? initiated.trim() : "";
  if (text) {
    // Day first (01/10/2026 is 1 October). This is checked before Date.parse, which would read it month first.
    const m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) {
      const ms = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      if (!isNaN(ms)) return new Date(ms).toISOString();
    }
    const direct = parseDbTimestamp(text);
    if (!isNaN(direct)) return new Date(direct).toISOString();
  }
  const c = parseDbTimestamp(created);
  return isNaN(c) ? null : new Date(c).toISOString();
}

export async function getCallbackAgentKpis(db: DbAdapter, nowMs: number = Date.now()): Promise<AgentKpiReport> {
  await closeMaturedCallbackJobs(db);
  const settings = await getCallbackSettings(db);
  const agents = (await getValidCallbackAgents(db, settings.callback_team_tag)).map((a) => ({ id: num(a.id), name: a.name }));
  const lowerBound = dateOnly(nowMs - (KPI_WINDOW_DAYS + 1) * DAY_MS);

  const rows = await db.queryAll<any>(
    `SELECT id, assigned_agent_id, client_phone, vehicle_reg, status, latest_outcome, closed_at, initiated_date, created_at
     FROM callback_jobs
     WHERE status = 'AMBER' OR (closed_at IS NOT NULL AND closed_at >= ?)`,
    [lowerBound]
  );
  const jobs = rows.map((r) => ({ ...r, id: num(r.id), assigned_agent_id: r.assigned_agent_id === null || r.assigned_agent_id === undefined ? null : num(r.assigned_agent_id) }));
  const open = jobs.filter((j) => j.status === "AMBER");
  const activity = await computeCallbackJobsActivity(db, open);

  const records: KpiRecord[] = jobs.map((j) => {
    const act = activity.get(j.id);
    return {
      agent_id: j.assigned_agent_id,
      customer_key: String(j.client_phone),
      status: j.status,
      closed_by_upload: j.status === "GREEN" && j.latest_outcome === "ABSENT_FROM_LATEST_EXPORT",
      closed_at: j.closed_at,
      reference_at: callbackReferenceDate(j.initiated_date, j.created_at),
      calls: act?.attempt_count ?? 0,
      sms: act?.sms_count ?? 0,
    };
  });

  return buildReport(db, "callbacks", nowMs, agents, records, { calls: settings.max_attempts, sms: settings.max_sms_attempts }, "Closed by upload");
}
// V15 END agentKpiService.ts
