// FIXPASS pendingSubmissions.ts
import { DbAdapter, DbTransactionClient } from "./db";
import { COUNTED_CALL_STATUSES, hasReachedMaxAttempts, normalizeRegAlphaNumeric } from "./insuranceCallbacks";
import { HttpError } from "./httpError";
import {
  ABSENT_CLOSE_OUTCOMES,
  PENDING_JOB_TYPES,
  PendingJobType,
  isAgentOutcome,
  normalizeJobType,
  parseJobStatus,
  JOB_TYPE_LABELS,
  statusForAgentOutcome,
} from "./pendingSubmissionOutcomes";
import { markImportRecords } from "./dataReset";
import { planRebalance, RebalanceUnit } from "./pendingRebalance";

/** Anything that can run queries: a DbAdapter or a transaction client. */
type Q = DbTransactionClient;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingSubmissionSettings {
  id: number;
  callback_team_tag: string;
  max_attempts: number;
  max_sms_attempts: number;
  overdue_after_days: number;
  max_attempts_grace_minutes: number;
  disappearance_alert_fixed_count: number;
  disappearance_alert_percentage: number;
  solver_sms_auto_send: boolean;
  solver_sms_template: string;
  solver_sms_max_resends: number;
  updated_at: string;
}

export interface RawPendingSubmissionRow {
  external_id: number | string;
  solver_name?: string;
  solver_contact?: string;
  solver_email?: string;
  vehicle_reg?: string;
  insurance_company?: string;
  client_phone?: string;
  customer_email?: string;
  schedule_date?: string;
  latest_pending_reason?: string;
  /** "Pending Inspection" or "Pending Submission". Required: a row without a recognised value is skipped. */
  job_status?: string;
  /** The spreadsheet row number, so a skipped row can be reported correctly. */
  row_number?: number;
}

export interface PendingSubmissionJobView {
  id: number;
  external_id: number;
  solver_name: string | null;
  solver_contact: string;
  solver_contact_raw: string;
  solver_email: string | null;
  vehicle_reg: string;
  vehicle_reg_raw: string;
  insurance_company: string | null;
  client_phone: string;
  client_phone_raw: string;
  customer_email: string | null;
  schedule_date: string | null;
  latest_pending_reason: string | null;
  job_type: PendingJobType;
  type_changed_at: string | null;
  status: "GREEN" | "AMBER" | "RED";
  latest_outcome: string | null;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  scheduled_at: string | null;
  scheduled_place: string | null;
  solver_notification_status: string | null;
  solver_notified_at: string | null;
  solver_notification_error: string | null;
  solver_notification_message: string | null;
  solver_notification_transaction_id: string | null;
  solver_notification_attempts: number;
  solver_notification_attempted_at: string | null;
  first_imported_at: string;
  last_seen_in_import_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  client_attempt_count: number;
  solver_attempt_count: number;
  last_client_attempt_at: string | null;
  client_sms_count: number;
  is_overdue: boolean;
  days_overdue: number;
  days_pending: number;
}

export interface PendingSubmissionLog {
  id: number;
  pending_submission_job_id: number;
  outcome: string;
  comment: string;
  logged_by: string;
  resulting_status: string;
  scheduled_at: string | null;
  scheduled_place: string | null;
  created_at: string;
}

export interface JobActivity {
  client_attempt_count: number;
  solver_attempt_count: number;
  last_client_attempt_at: string | null;
  client_sms_count: number;
  last_client_sms_at: string | null;
}

// ---------------------------------------------------------------------------
// Normalisation and time helpers
// ---------------------------------------------------------------------------

/** Strip every non-digit, keep the last 9 digits. */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/** Uppercase and strip all whitespace. */
export function normalizeVehicleReg(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).toUpperCase().replace(/\s+/g, "");
}

/**
 * Milliseconds since epoch for a database timestamp, or NaN.
 * Accepts Date objects (pg) and strings. A string with no timezone designator
 * (SQLite CURRENT_TIMESTAMP, "YYYY-MM-DD HH:MM:SS") is interpreted as UTC.
 */
export function parseDbTimestamp(value: unknown): number {
  if (value === null || value === undefined || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    return Date.parse(s.replace(" ", "T") + "Z");
  }
  return Date.parse(s);
}

/** PostgreSQL returns BIGINT/BIGSERIAL columns as strings. Always coerce ids before comparing or using them as Map keys. */
function num(v: unknown): number {
  return Number(v);
}
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "t" || v === "true";
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SOLVER_SMS_PLACEHOLDERS = [
  "solver_name",
  "vehicle_reg",
  "scheduled_at",
  "scheduled_place",
  "client_phone",
  "agent_name",
  "insurance_company",
] as const;
const REQUIRED_TEMPLATE_PLACEHOLDERS = ["vehicle_reg", "scheduled_at", "scheduled_place"];
export const DEFAULT_SOLVER_SMS_TEMPLATE =
  "Hi {solver_name}, inspection for {vehicle_reg} is scheduled for {scheduled_at} at {scheduled_place}.";

/** Returns an error message, or null when the template is acceptable. */
export function validateSolverSmsTemplate(template: unknown): string | null {
  if (typeof template !== "string" || template.trim().length === 0) return "The SMS template cannot be empty.";
  if (template.length > 480) return "The SMS template must be 480 characters or fewer.";
  const tokens = template.match(/\{[^{}]*\}/g) ?? [];
  for (const token of tokens) {
    const name = token.slice(1, -1);
    if (!(SOLVER_SMS_PLACEHOLDERS as readonly string[]).includes(name)) {
      return `Unknown placeholder ${token}. Allowed: ${SOLVER_SMS_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`;
    }
  }
  for (const required of REQUIRED_TEMPLATE_PLACEHOLDERS) {
    if (!template.includes(`{${required}}`)) return `The SMS template must include {${required}}.`;
  }
  return null;
}

function mapSettingsRow(row: any): PendingSubmissionSettings {
  return {
    id: 1,
    callback_team_tag: row.callback_team_tag || "Callback Team(Submission)",
    max_attempts: Number(row.max_attempts ?? 4),
    max_sms_attempts: Number(row.max_sms_attempts ?? 4),
    overdue_after_days: Number(row.overdue_after_days ?? 3),
    max_attempts_grace_minutes: Number(row.max_attempts_grace_minutes ?? 30),
    disappearance_alert_fixed_count: Number(row.disappearance_alert_fixed_count ?? 50),
    disappearance_alert_percentage: Number(row.disappearance_alert_percentage ?? 30),
    solver_sms_auto_send: row.solver_sms_auto_send === undefined || row.solver_sms_auto_send === null ? true : toBool(row.solver_sms_auto_send),
    solver_sms_template: row.solver_sms_template || DEFAULT_SOLVER_SMS_TEMPLATE,
    solver_sms_max_resends: Number(row.solver_sms_max_resends ?? 3),
    updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
  };
}

export async function getPendingSubmissionSettings(db: Q): Promise<PendingSubmissionSettings> {
  const row = await db.queryOne<any>(`SELECT * FROM pending_submission_settings WHERE id = 1`);
  return mapSettingsRow(row ?? {});
}

function intInRange(body: Record<string, unknown>, key: string, min: number, max: number, label: string): number | undefined {
  if (body[key] === undefined) return undefined;
  const n = typeof body[key] === "string" && (body[key] as string).trim() !== "" ? Number(body[key]) : body[key];
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

/**
 * Updates only the keys present in `body`. Unknown keys (id, callback_team_tag, updated_at, ...) are ignored.
 * Every changed key is written to settings_change_log as pending_submissions.<key>.
 */
export async function updatePendingSubmissionSettings(
  db: DbAdapter,
  body: Record<string, unknown>,
  changedBy = "Admin"
): Promise<PendingSubmissionSettings> {
  const current = await getPendingSubmissionSettings(db);
  const updates: Record<string, string | number | boolean> = {};

  const put = (key: keyof PendingSubmissionSettings, value: number | boolean | string | undefined) => {
    if (value !== undefined && value !== current[key]) updates[key] = value;
  };

  put("max_attempts", intInRange(body, "max_attempts", 1, 20, "Max attempts"));
  put("max_sms_attempts", intInRange(body, "max_sms_attempts", 1, 20, "Max SMS attempts"));
  put("overdue_after_days", intInRange(body, "overdue_after_days", 1, 90, "Overdue threshold (days)"));
  put("max_attempts_grace_minutes", intInRange(body, "max_attempts_grace_minutes", 0, 1440, "Grace period (minutes)"));
  put("disappearance_alert_fixed_count", intInRange(body, "disappearance_alert_fixed_count", 1, 10000, "Disappearance count limit"));
  put("disappearance_alert_percentage", intInRange(body, "disappearance_alert_percentage", 1, 100, "Disappearance percentage limit"));
  put("solver_sms_max_resends", intInRange(body, "solver_sms_max_resends", 0, 10, "Resend limit"));

  if (body.solver_sms_auto_send !== undefined) {
    if (typeof body.solver_sms_auto_send !== "boolean") throw new HttpError(400, "Auto-send must be true or false.");
    put("solver_sms_auto_send", body.solver_sms_auto_send);
  }
  if (body.solver_sms_template !== undefined) {
    const problem = validateSolverSmsTemplate(body.solver_sms_template);
    if (problem) throw new HttpError(400, problem);
    put("solver_sms_template", body.solver_sms_template as string);
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) return current;

  await db.transaction(async (tx) => {
    const setSql = keys.map((k) => `${k} = ?`).join(", ");
    await tx.execute(`UPDATE pending_submission_settings SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`, keys.map((k) => updates[k]));
    for (const k of keys) {
      await tx.execute(
        `INSERT INTO settings_change_log (setting_key, old_value, new_value, changed_by) VALUES (?, ?, ?, ?)`,
        [`pending_submissions.${k}`, String(current[k as keyof PendingSubmissionSettings]), String(updates[k]), changedBy]
      );
    }
  });

  return getPendingSubmissionSettings(db);
}

export async function getValidSubmissionAgents(
  db: Q,
  tag = "Callback Team(Submission)"
): Promise<Array<{ id: number; name: string }>> {
  const normalizedTag = (tag || "Callback Team(Submission)").trim().toLowerCase();
  const rows = await db.queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM agents WHERE LOWER(TRIM(tag)) = LOWER(TRIM(?)) AND archived_at IS NULL ORDER BY name ASC`,
    [normalizedTag]
  );
  return rows.map((r) => ({ id: num(r.id), name: r.name }));
}

// ---------------------------------------------------------------------------
// Assignment (pure)
// ---------------------------------------------------------------------------

export interface AssignmentGroup {
  client_phone: string;
  count: number;
}

/**
 * Equal split by open-job load. One client is never split across agents.
 * 1. A client that already has an open job with an active agent keeps that agent (sticky).
 * 2. Otherwise the group goes to the active agent with the fewest open jobs (ties: name, then id).
 * Groups are processed largest first (ties: client_phone) so the result is deterministic.
 */
export function planAssignments(
  groups: AssignmentGroup[],
  agents: Array<{ id: number; name: string }>,
  openLoad: Map<number, number>,
  stickyByClient: Map<string, number>
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (agents.length === 0) {
    for (const g of groups) out.set(g.client_phone, null);
    return out;
  }
  const load = new Map<number, number>(agents.map((a) => [a.id, openLoad.get(a.id) ?? 0]));
  const active = new Set(agents.map((a) => a.id));
  const sorted = [...groups].sort((a, b) => b.count - a.count || a.client_phone.localeCompare(b.client_phone));

  for (const g of sorted) {
    const sticky = stickyByClient.get(g.client_phone);
    let chosen: number;
    if (sticky !== undefined && active.has(sticky)) {
      chosen = sticky;
    } else {
      const ranked = [...agents].sort(
        (a, b) => (load.get(a.id)! - load.get(b.id)!) || a.name.localeCompare(b.name) || a.id - b.id
      );
      chosen = ranked[0].id;
    }
    load.set(chosen, (load.get(chosen) ?? 0) + g.count);
    out.set(g.client_phone, chosen);
  }
  return out;
}

/**
 * The key that keeps a customer's vehicles together for one agent: the client's number for an inspection job and the
 * solver's number for a submission job (the solver is the person the agent works with on a submission job).
 */
export function groupKeyFor(job: { job_type?: unknown; client_phone: string; solver_contact: string }): string {
  return normalizeJobType(job.job_type) === "SUBMISSION" ? job.solver_contact : job.client_phone;
}

/**
 * Applies planAssignments to each job type on its own, so the inspection work and the submission work are each
 * shared equally. `held` is the open work already held by ACTIVE agents. The result is keyed `${job_type}|${key}`.
 */
export function planAssignmentsByType(
  pool: Array<{ job_type: PendingJobType; key: string }>,
  agents: Array<{ id: number; name: string }>,
  held: Array<{ job_type: PendingJobType; key: string; agent_id: number }>
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const type of PENDING_JOB_TYPES) {
    const groupCounts = new Map<string, number>();
    for (const r of pool) if (r.job_type === type) groupCounts.set(r.key, (groupCounts.get(r.key) ?? 0) + 1);
    if (groupCounts.size === 0) continue;

    const openLoad = new Map<number, number>();
    const stickyCounts = new Map<string, Map<number, number>>();
    for (const j of held) {
      if (j.job_type !== type) continue;
      openLoad.set(j.agent_id, (openLoad.get(j.agent_id) ?? 0) + 1);
      const perKey = stickyCounts.get(j.key) ?? new Map<number, number>();
      perKey.set(j.agent_id, (perKey.get(j.agent_id) ?? 0) + 1);
      stickyCounts.set(j.key, perKey);
    }
    const sticky = new Map<string, number>();
    for (const [key, perAgent] of stickyCounts) {
      sticky.set(key, [...perAgent.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);
    }
    // AssignmentGroup.client_phone carries the group key (client number or solver number).
    const plan = planAssignments(
      [...groupCounts.entries()].map(([client_phone, count]) => ({ client_phone, count })),
      agents,
      openLoad,
      sticky
    );
    for (const [key, agentId] of plan) out.set(`${type}|${key}`, agentId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Overdue (pure)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Overdue is measured from schedule_date, never from the import date. */
export function computeOverdue(
  status: string,
  scheduleDate: unknown,
  overdueAfterDays: number,
  nowMs: number = Date.now()
): { is_overdue: boolean; days_overdue: number } {
  if (status !== "AMBER") return { is_overdue: false, days_overdue: 0 };
  const ms = parseDbTimestamp(scheduleDate);
  if (isNaN(ms)) return { is_overdue: false, days_overdue: 0 };
  const over = nowMs - ms - overdueAfterDays * DAY_MS;
  if (over > 0) return { is_overdue: true, days_overdue: Math.ceil(over / DAY_MS) };
  return { is_overdue: false, days_overdue: 0 };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Activity (attempt counting)
// ---------------------------------------------------------------------------

export interface ContactJob {
  id: number;
  assigned_agent_id: number | null;
  client_phone: string;
  solver_contact: string;
  vehicle_reg: string;
  first_imported_at: unknown;
  /** Missing means INSPECTION. */
  job_type?: string;
  /** When the job moved from one type to the other. Counting restarts from here. */
  type_changed_at?: unknown;
}

/** The number whose calls and SMS count for this job: the client for an inspection job, the solver for a submission job. */
export function primaryPhoneOf(job: { job_type?: unknown; client_phone: string; solver_contact: string }): string {
  return normalizePhone(normalizeJobType(job.job_type) === "SUBMISSION" ? job.solver_contact : job.client_phone);
}

/** Counting starts at the later of the first import and the last type change. NaN when the import time is unreadable. */
export function countingStartMs(job: { first_imported_at: unknown; type_changed_at?: unknown }): number {
  const first = parseDbTimestamp(job.first_imported_at);
  if (isNaN(first)) return NaN;
  const changed = job.type_changed_at ? parseDbTimestamp(job.type_changed_at) : NaN;
  return isNaN(changed) ? first : Math.max(first, changed);
}

export interface ContactEvent {
  id: number;
  agent_id: number | null;
  type: string;
  status: string | null;
  timestamp: unknown;
  target_phone: string | null;
  reg_no: string | null;
}

/**
 * Pure counting rule (no database). The client rules are the same as Insurance Job Callbacks:
 * - Only events made by the job's ASSIGNED agent count.
 * - A call counts only when type is CALL and status is in COUNTED_CALL_STATUSES (OUTGOING), and its normalised
 *   phone equals the client's phone.
 * - An SMS counts when type is SMS and its normalised phone equals the client's phone OR its registration
 *   (letters and digits only) equals the job's vehicle registration.
 * - An event is never counted twice for the same job.
 * Pending Submissions keeps one rule Callbacks does not have: an event only counts if it happened on or after
 * the job's first_imported_at.
 * Solver calls are informational: any team agent, OUTGOING, phone equals the solver's phone.
 * A submission job (the car was inspected but the solver has not submitted the data) counts the SOLVER's number as
 * its primary contact, exactly as an inspection job counts the client's. Calls to any other number (the client, a
 * broker) are not counted. Counting starts at the later of first_imported_at and type_changed_at.
 */
export function countClientContacts(
  jobs: ContactJob[],
  events: ContactEvent[],
  teamAgentIds: ReadonlySet<number>
): Map<number, JobActivity> {
  const result = new Map<number, JobActivity>();
  for (const j of jobs) {
    result.set(j.id, {
      client_attempt_count: 0,
      solver_attempt_count: 0,
      last_client_attempt_at: null,
      client_sms_count: 0,
      last_client_sms_at: null,
    });
  }

  const firstMs = new Map<number, number>();
  const byClient = new Map<string, ContactJob[]>();
  const byReg = new Map<string, ContactJob[]>();
  const bySolver = new Map<string, ContactJob[]>();
  const push = (m: Map<string, ContactJob[]>, key: string, job: ContactJob) => {
    if (!key) return;
    const list = m.get(key);
    if (list) list.push(job);
    else m.set(key, [job]);
  };
  for (const j of jobs) {
    const ms = countingStartMs(j);
    if (isNaN(ms)) continue;
    firstMs.set(j.id, ms);
    // byClient holds the PRIMARY contact: the client for an inspection job, the solver for a submission job.
    push(byClient, primaryPhoneOf(j), j);
    push(byReg, normalizeRegAlphaNumeric(j.vehicle_reg), j);
    push(bySolver, normalizePhone(j.solver_contact), j);
  }

  const lastCallMs = new Map<number, number>();
  const lastSmsMs = new Map<number, number>();

  for (const ev of events) {
    if (ev.agent_id === null || ev.agent_id === undefined) continue;
    const agentId = Number(ev.agent_id);
    const ts = parseDbTimestamp(ev.timestamp);
    if (isNaN(ts)) continue;
    const isCall = ev.type === "CALL" && COUNTED_CALL_STATUSES.has(String(ev.status ?? "").toUpperCase());
    const isSms = ev.type === "SMS";
    if (!isCall && !isSms) continue;

    const phone = normalizePhone(ev.target_phone);
    const reg = isSms ? normalizeRegAlphaNumeric(ev.reg_no) : "";

    const candidates = new Set<ContactJob>();
    if (phone) for (const j of byClient.get(phone) ?? []) candidates.add(j);
    if (reg) for (const j of byReg.get(reg) ?? []) candidates.add(j);

    for (const job of candidates) {
      if (job.assigned_agent_id === null || Number(job.assigned_agent_id) !== agentId) continue;
      if (ts < firstMs.get(job.id)!) continue;
      const act = result.get(job.id)!;
      if (isCall) {
        act.client_attempt_count += 1;
        if (!lastCallMs.has(job.id) || ts > lastCallMs.get(job.id)!) lastCallMs.set(job.id, ts);
      } else {
        act.client_sms_count += 1;
        if (!lastSmsMs.has(job.id) || ts > lastSmsMs.get(job.id)!) lastSmsMs.set(job.id, ts);
      }
    }

    if (isCall && phone && teamAgentIds.has(agentId)) {
      for (const job of bySolver.get(phone) ?? []) {
        if (ts < firstMs.get(job.id)!) continue;
        result.get(job.id)!.solver_attempt_count += 1;
      }
    }
  }

  for (const [jobId, ms] of lastCallMs) result.get(jobId)!.last_client_attempt_at = new Date(ms).toISOString();
  for (const [jobId, ms] of lastSmsMs) result.get(jobId)!.last_client_sms_at = new Date(ms).toISOString();
  return result;
}

/**
 * Loads the relevant events and applies countClientContacts. Only active agents on the submission team count
 * (archived agents and agents on other teams never do), exactly as in Callbacks.
 */
export async function computePendingSubmissionActivity(db: Q, jobs: ContactJob[]): Promise<Map<number, JobActivity>> {
  if (jobs.length === 0) return new Map();

  const settings = await getPendingSubmissionSettings(db);
  const agents = (
    await db.queryAll<{ id: number }>(
      `SELECT id FROM agents WHERE LOWER(TRIM(tag)) = LOWER(TRIM(?)) AND archived_at IS NULL`,
      [settings.callback_team_tag]
    )
  ).map((a) => num(a.id));
  const teamAgentIds = new Set<number>(agents);

  let minMs = Infinity;
  for (const j of jobs) {
    const ms = parseDbTimestamp(j.first_imported_at);
    if (!isNaN(ms) && ms < minMs) minMs = ms;
  }
  if (agents.length === 0 || !isFinite(minMs)) return countClientContacts(jobs, [], teamAgentIds);

  // Coarse prefilter only (date-only bound, two days of slack). The exact per-job cutoff is applied in code.
  const lowerBound = new Date(minMs - 2 * DAY_MS).toISOString().slice(0, 10);
  const placeholders = agents.map(() => "?").join(", ");
  const events = await db.queryAll<ContactEvent>(
    `SELECT id, agent_id, type, status, timestamp, target_phone, reg_no
     FROM events
     WHERE agent_id IN (${placeholders}) AND timestamp >= ?`,
    [...agents, lowerBound]
  );
  return countClientContacts(jobs, events, teamAgentIds);
}

// Max attempts sweep
// ---------------------------------------------------------------------------

/**
 * Closes AMBER jobs RED (MAX_ATTEMPTS_REACHED) when client_attempt_count >= max_attempts AND client_sms_count >=
 * max_sms_attempts (the Insurance Job Callbacks rule) AND the latest counted call or SMS is at least
 * max_attempts_grace_minutes old. Solver attempts never count.
 * Safe to call concurrently: the update is conditional on status = 'AMBER' and the log row is only written
 * when exactly one row changed. Returns the number of jobs closed.
 */
export async function closeMaturedPendingSubmissions(db: DbAdapter, opts: { jobId?: number } = {}): Promise<number> {
  const settings = await getPendingSubmissionSettings(db);
  let sql = `SELECT id, assigned_agent_id, client_phone, solver_contact, vehicle_reg, first_imported_at, job_type, type_changed_at FROM pending_submission_jobs WHERE status = 'AMBER'`;
  const params: any[] = [];
  if (opts.jobId !== undefined) {
    sql += ` AND id = ?`;
    params.push(opts.jobId);
  }
  const jobs: ContactJob[] = (await db.queryAll<ContactJob>(sql, params)).map((j) => ({
    ...j,
    id: num(j.id),
    assigned_agent_id: numOrNull(j.assigned_agent_id),
  }));
  if (jobs.length === 0) return 0;

  const activity = await computePendingSubmissionActivity(db, jobs);
  const graceMs = settings.max_attempts_grace_minutes * 60_000;
  const now = Date.now();
  let closed = 0;

  for (const job of jobs) {
    const act = activity.get(job.id);
    if (!act) continue;
    const reached = hasReachedMaxAttempts(
      { attempt_count: act.client_attempt_count, sms_count: act.client_sms_count },
      { max_attempts: settings.max_attempts, max_sms_attempts: settings.max_sms_attempts }
    );
    if (!reached) continue;
    const lastCallMs = act.last_client_attempt_at ? Date.parse(act.last_client_attempt_at) : NaN;
    const lastSmsMs = act.last_client_sms_at ? Date.parse(act.last_client_sms_at) : NaN;
    const lastContactMs = Math.max(isNaN(lastCallMs) ? -Infinity : lastCallMs, isNaN(lastSmsMs) ? -Infinity : lastSmsMs);
    if (!isFinite(lastContactMs)) continue;
    if (now - lastContactMs < graceMs) continue;

    closed += await db.transaction(async (tx) => {
      const upd = await tx.execute(
        `UPDATE pending_submission_jobs
         SET status = 'RED', closed_at = ?, latest_outcome = 'MAX_ATTEMPTS_REACHED', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'AMBER'`,
        [new Date().toISOString(), job.id]
      );
      if (upd.affectedRows !== 1) return 0;
      await tx.execute(
        `INSERT INTO pending_submission_logs (pending_submission_job_id, outcome, comment, logged_by, resulting_status)
         VALUES (?, 'MAX_ATTEMPTS_REACHED', 'Automatically closed: minimum outgoing calls and minimum SMS reached.', 'System', 'RED')`,
        [job.id]
      );
      return 1;
    });
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportResult {
  file_name: string;
  imported_by: string;
  row_count_total: number;
  new_records_count: number;
  skipped_open_count: number;
  skipped_closed_count: number;
  auto_closed_absent_count: number;
  reopened_count: number;
  invalid_rows_count: number;
  /** Every skipped row (up to MAX_REPORTED_INVALID_ROWS), so the summary can show exactly which rows have a problem. */
  invalid_rows: InvalidImportRow[];
  duplicate_in_file_count: number;
  /** Open or closed jobs that reappeared with the other job type and were moved (attempt counts restart). */
  type_changed_count: number;
  by_type: Record<PendingJobType, ImportTypeSummary>;
}

export interface InvalidImportRow {
  /** The spreadsheet row number (the header is row 1). */
  row: number;
  reason: string;
  external_id: string;
  vehicle_reg: string;
  job_status: string;
}

export interface ImportTypeSummary {
  rows_in_file: number;
  new_records: number;
  refreshed: number;
  /** Jobs that moved into this type from the other type in this upload. */
  moved_in: number;
  /** Jobs closed as absent by an earlier upload that reappeared in this type. */
  reopened: number;
  auto_closed_absent: number;
}

const MAX_REPORTED_INVALID_ROWS = 1000;

export interface ImportConfirmation {
  requires_confirmation: true;
  would_close_count: number;
  total_open: number;
  would_close_percentage: number;
  fixed_limit: number;
  percentage_limit: number;
}

interface CleanRow {
  external_id: number;
  solver_name: string | null;
  solver_contact: string;
  solver_contact_raw: string;
  solver_email: string | null;
  vehicle_reg: string;
  vehicle_reg_raw: string;
  insurance_company: string | null;
  client_phone: string;
  client_phone_raw: string;
  customer_email: string | null;
  schedule_date: string | null;
  latest_pending_reason: string | null;
  job_type: PendingJobType;
}

const JOB_STATUS_HINT = "expected Pending Inspection or Pending Submission";

function cleanImportRow(raw: RawPendingSubmissionRow): CleanRow | string {
  const idText = String(raw.external_id ?? "").trim();
  if (!/^\d+$/.test(idText) || !Number.isSafeInteger(Number(idText))) return "ID is missing or not a whole number";
  const jobStatusText = String(raw.job_status ?? "").trim();
  const jobType = parseJobStatus(jobStatusText);
  if (jobType === null) {
    return jobStatusText === ""
      ? `job_status is missing (${JOB_STATUS_HINT})`
      : `job_status "${jobStatusText.slice(0, 40)}" is not recognised (${JOB_STATUS_HINT})`;
  }
  const clientPhoneRaw = String(raw.client_phone ?? "").trim();
  const clientPhone = normalizePhone(clientPhoneRaw);
  if (clientPhoneRaw.replace(/\D/g, "").length < 9) return "Client number has fewer than 9 digits";
  const vehicleRegRaw = String(raw.vehicle_reg ?? "").trim();
  if (!vehicleRegRaw) return "Vehicle registration is missing";
  const solverContactRaw = String(raw.solver_contact ?? "").trim();
  // A submission job is worked through the solver, so the solver's number is required for it.
  if (jobType === "SUBMISSION" && solverContactRaw.replace(/\D/g, "").length < 9) {
    return solverContactRaw === ""
      ? "Solver number is missing, which a Pending Submission job needs"
      : "Solver number has fewer than 9 digits, which a Pending Submission job needs";
  }
  const sched = raw.schedule_date ? parseDbTimestamp(raw.schedule_date) : NaN;
  const text = (v: unknown) => {
    const t = String(v ?? "").trim();
    return t === "" ? null : t;
  };
  return {
    external_id: Number(idText),
    solver_name: text(raw.solver_name),
    solver_contact: normalizePhone(solverContactRaw),
    solver_contact_raw: solverContactRaw,
    solver_email: text(raw.solver_email),
    vehicle_reg: normalizeVehicleReg(vehicleRegRaw),
    vehicle_reg_raw: vehicleRegRaw,
    insurance_company: text(raw.insurance_company),
    client_phone: clientPhone,
    client_phone_raw: clientPhoneRaw,
    customer_email: text(raw.customer_email),
    schedule_date: isNaN(sched) ? null : new Date(sched).toISOString(),
    latest_pending_reason: text(raw.latest_pending_reason),
    job_type: jobType,
  };
}

export async function importPendingSubmissions(
  db: DbAdapter,
  fileName: string,
  importedBy: string,
  rows: RawPendingSubmissionRow[],
  options: { confirmed?: boolean } = {}
): Promise<ImportResult | ImportConfirmation> {
  // 1. Validate and de-duplicate rows (no writes yet).
  const clean: CleanRow[] = [];
  const invalid: InvalidImportRow[] = [];
  const seen = new Set<number>();
  let duplicateInFile = 0;
  rows.forEach((raw, index) => {
    const result = cleanImportRow(raw);
    if (typeof result === "string") {
      invalid.push({
        row: Number.isInteger(raw.row_number) && (raw.row_number as number) > 0 ? (raw.row_number as number) : index + 2,
        reason: result,
        external_id: String(raw.external_id ?? "").trim(),
        vehicle_reg: String(raw.vehicle_reg ?? "").trim(),
        job_status: String(raw.job_status ?? "").trim(),
      });
    } else if (seen.has(result.external_id)) {
      duplicateInFile += 1;
    } else {
      seen.add(result.external_id);
      clean.push(result);
    }
  });
  if (clean.length === 0) {
    throw new HttpError(400, "No valid rows in the upload.", {
      invalid_rows: invalid.slice(0, MAX_REPORTED_INVALID_ROWS),
      invalid_rows_count: invalid.length,
    });
  }

  const settings = await getPendingSubmissionSettings(db);
  const agents = await getValidSubmissionAgents(db, settings.callback_team_tag);
  const activeAgentIds = new Set(agents.map((a) => a.id));

  // 2. One query for the current state.
  const existingRows = (
    await db.queryAll<{
      id: number;
      external_id: number;
      status: string;
      latest_outcome: string | null;
      client_phone: string;
      solver_contact: string;
      job_type: string | null;
      assigned_agent_id: number | null;
    }>(
      `SELECT id, external_id, status, latest_outcome, client_phone, solver_contact, job_type, assigned_agent_id FROM pending_submission_jobs`
    )
  ).map((r) => ({
    ...r,
    id: num(r.id),
    external_id: num(r.external_id),
    assigned_agent_id: numOrNull(r.assigned_agent_id),
    job_type: normalizeJobType(r.job_type),
  }));
  const existing = new Map(existingRows.map((r) => [Number(r.external_id), r]));
  const openJobs = existingRows.filter((r) => r.status === "AMBER");

  // 3. Safety check BEFORE any write. A record is only ever closed as absent when its own job type is present in the file,
  // so an upload that contains one type never closes the open jobs of the other type.
  const typesInFile = new Set<PendingJobType>(clean.map((r) => r.job_type));
  const openInScope = openJobs.filter((r) => typesInFile.has(r.job_type));
  const missing = openInScope.filter((r) => !seen.has(Number(r.external_id)));
  const totalOpen = openInScope.length;
  const pct = totalOpen > 0 ? Math.round((missing.length / totalOpen) * 100) : 0;
  const exceeds = missing.length > settings.disappearance_alert_fixed_count || pct > settings.disappearance_alert_percentage;
  if (exceeds && !options.confirmed) {
    return {
      requires_confirmation: true,
      would_close_count: missing.length,
      total_open: totalOpen,
      would_close_percentage: pct,
      fixed_limit: settings.disappearance_alert_fixed_count,
      percentage_limit: settings.disappearance_alert_percentage,
    };
  }

  // 4. Classify rows.
  const statusOf = (r: CleanRow) => existing.get(r.external_id);
  const newRows = clean.filter((r) => !existing.has(r.external_id));
  // Same type and still open: refresh.
  const refreshRows = clean.filter((r) => {
    const e = statusOf(r);
    return e !== undefined && e.status === "AMBER" && e.job_type === r.job_type;
  });
  // Open, but now the other type: the job moves to the other type and its attempt counts restart.
  const typeChangeOpenRows = clean.filter((r) => {
    const e = statusOf(r);
    return e !== undefined && e.status === "AMBER" && e.job_type !== r.job_type;
  });
  // Closed as absent by an earlier upload and back in the same type: reopen (unchanged rule).
  const reopenAbsentRows = clean.filter((r) => {
    const e = statusOf(r);
    return e !== undefined && e.status === "GREEN" && ABSENT_CLOSE_OUTCOMES.includes(e.latest_outcome ?? "") && e.job_type === r.job_type;
  });
  // Closed (scheduled, submitted, withdrawn, max attempts or absent) and now the other type: a new task, reopen it.
  const reopenTypeRows = clean.filter((r) => {
    const e = statusOf(r);
    return e !== undefined && e.status !== "AMBER" && e.job_type !== r.job_type;
  });
  const skippedClosed =
    clean.filter((r) => {
      const e = statusOf(r);
      return e !== undefined && e.status !== "AMBER";
    }).length -
    reopenAbsentRows.length -
    reopenTypeRows.length;

  // 5. Plan assignments, each job type on its own. The pool is the new rows, the rows that change type, and reopened rows
  // whose agent is no longer active. A reopened row that keeps its agent counts as that agent's load.
  const leavingIds = new Set<number>(typeChangeOpenRows.map((r) => statusOf(r)!.id));
  const held: Array<{ job_type: PendingJobType; key: string; agent_id: number }> = [];
  for (const j of openJobs) {
    if (leavingIds.has(j.id)) continue;
    if (j.assigned_agent_id === null || !activeAgentIds.has(j.assigned_agent_id)) continue;
    held.push({ job_type: j.job_type, key: groupKeyFor(j), agent_id: j.assigned_agent_id });
  }
  const reopenKeepsAgent = (r: CleanRow) => {
    const e = statusOf(r)!;
    return e.assigned_agent_id !== null && activeAgentIds.has(e.assigned_agent_id);
  };
  for (const r of reopenAbsentRows) {
    if (reopenKeepsAgent(r)) held.push({ job_type: r.job_type, key: groupKeyFor(r), agent_id: statusOf(r)!.assigned_agent_id! });
  }
  const pool = [...newRows, ...typeChangeOpenRows, ...reopenTypeRows, ...reopenAbsentRows.filter((r) => !reopenKeepsAgent(r))];
  const plan = planAssignmentsByType(
    pool.map((r) => ({ job_type: r.job_type, key: groupKeyFor(r) })),
    agents,
    held
  );
  const plannedAgent = (r: CleanRow) => plan.get(`${r.job_type}|${groupKeyFor(r)}`) ?? null;

  // 6. Write everything in one transaction. Inside the callback use ONLY `tx`, never `db`.
  const emptyType = (): ImportTypeSummary => ({ rows_in_file: 0, new_records: 0, refreshed: 0, moved_in: 0, reopened: 0, auto_closed_absent: 0 });
  const byType: Record<PendingJobType, ImportTypeSummary> = { INSPECTION: emptyType(), SUBMISSION: emptyType() };
  for (const r of clean) byType[r.job_type].rows_in_file += 1;
  const counts = { added: 0, refreshed: 0, reopened: 0, absentClosed: 0, typeChanged: 0 };
  const createdJobIds: number[] = [];
  const absentClosedJobIds: number[] = [];
  const refreshFields = (r: CleanRow) => [
    r.latest_pending_reason, r.schedule_date, r.solver_name,
    r.solver_contact, r.solver_contact, r.solver_contact_raw, r.solver_contact_raw,
    r.solver_email, r.insurance_company,
  ];
  await db.transaction(async (tx) => {
    for (const r of newRows) {
      const inserted = await tx.execute(
        `INSERT INTO pending_submission_jobs (
           external_id, solver_name, solver_contact, solver_contact_raw, solver_email,
           vehicle_reg, vehicle_reg_raw, insurance_company, client_phone, client_phone_raw,
           customer_email, schedule_date, latest_pending_reason, status, assigned_agent_id,
           first_imported_at, last_seen_in_import_at, job_type
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AMBER', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
        [
          r.external_id, r.solver_name, r.solver_contact, r.solver_contact_raw, r.solver_email,
          r.vehicle_reg, r.vehicle_reg_raw, r.insurance_company, r.client_phone, r.client_phone_raw,
          r.customer_email, r.schedule_date, r.latest_pending_reason, plannedAgent(r), r.job_type,
        ]
      );
      createdJobIds.push(Number(inserted.lastInsertId));
      counts.added += 1;
      byType[r.job_type].new_records += 1;
    }

    for (const r of refreshRows) {
      const e = statusOf(r)!;
      await tx.execute(
        `UPDATE pending_submission_jobs
         SET last_seen_in_import_at = CURRENT_TIMESTAMP,
             latest_pending_reason = COALESCE(?, latest_pending_reason),
             schedule_date = COALESCE(?, schedule_date),
             solver_name = COALESCE(?, solver_name),
             solver_contact = CASE WHEN ? <> '' THEN ? ELSE solver_contact END,
             solver_contact_raw = CASE WHEN ? <> '' THEN ? ELSE solver_contact_raw END,
             solver_email = COALESCE(?, solver_email),
             insurance_company = COALESCE(?, insurance_company),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'AMBER'`,
        [...refreshFields(r), e.id]
      );
      counts.refreshed += 1;
      byType[r.job_type].refreshed += 1;
    }

    // An open job that is now the other type: move it, and restart its attempt counts from this moment.
    for (const r of typeChangeOpenRows) {
      const e = statusOf(r)!;
      const upd = await tx.execute(
        `UPDATE pending_submission_jobs
         SET job_type = ?, type_changed_at = CURRENT_TIMESTAMP, assigned_agent_id = ?, latest_outcome = 'TYPE_CHANGED_BY_SYSTEM',
             last_seen_in_import_at = CURRENT_TIMESTAMP,
             latest_pending_reason = COALESCE(?, latest_pending_reason),
             schedule_date = COALESCE(?, schedule_date),
             solver_name = COALESCE(?, solver_name),
             solver_contact = CASE WHEN ? <> '' THEN ? ELSE solver_contact END,
             solver_contact_raw = CASE WHEN ? <> '' THEN ? ELSE solver_contact_raw END,
             solver_email = COALESCE(?, solver_email),
             insurance_company = COALESCE(?, insurance_company),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'AMBER' AND job_type = ?`,
        [r.job_type, plannedAgent(r), ...refreshFields(r), e.id, e.job_type]
      );
      if (upd.affectedRows === 1) {
        await tx.execute(
          `INSERT INTO pending_submission_logs (pending_submission_job_id, outcome, comment, logged_by, resulting_status)
           VALUES (?, 'TYPE_CHANGED_BY_SYSTEM', ?, 'System', 'AMBER')`,
          [e.id, `Moved from ${JOB_TYPE_LABELS[e.job_type]} to ${JOB_TYPE_LABELS[r.job_type]}. Attempt counts restart.`]
        );
        counts.typeChanged += 1;
        byType[r.job_type].moved_in += 1;
      }
    }

    // A closed job that reappeared as the other type is a new task: reopen it and restart its attempt counts.
    for (const r of reopenTypeRows) {
      const e = statusOf(r)!;
      const upd = await tx.execute(
        `UPDATE pending_submission_jobs
         SET status = 'AMBER', closed_at = NULL, job_type = ?, type_changed_at = CURRENT_TIMESTAMP, assigned_agent_id = ?,
             latest_outcome = 'TYPE_CHANGED_BY_SYSTEM',
             last_seen_in_import_at = CURRENT_TIMESTAMP,
             latest_pending_reason = COALESCE(?, latest_pending_reason),
             schedule_date = COALESCE(?, schedule_date),
             solver_name = COALESCE(?, solver_name),
             solver_contact = CASE WHEN ? <> '' THEN ? ELSE solver_contact END,
             solver_contact_raw = CASE WHEN ? <> '' THEN ? ELSE solver_contact_raw END,
             solver_email = COALESCE(?, solver_email),
             insurance_company = COALESCE(?, insurance_company),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status <> 'AMBER' AND job_type = ?`,
        [r.job_type, plannedAgent(r), ...refreshFields(r), e.id, e.job_type]
      );
      if (upd.affectedRows === 1) {
        await tx.execute(
          `INSERT INTO pending_submission_logs (pending_submission_job_id, outcome, comment, logged_by, resulting_status)
           VALUES (?, 'TYPE_CHANGED_BY_SYSTEM', ?, 'System', 'AMBER')`,
          [
            e.id,
            `Reappeared as ${JOB_TYPE_LABELS[r.job_type]} after being closed as ${JOB_TYPE_LABELS[e.job_type]}. Reopened as a new task. Attempt counts restart.`,
          ]
        );
        counts.typeChanged += 1;
        byType[r.job_type].moved_in += 1;
      }
    }

    for (const r of reopenAbsentRows) {
      const e = statusOf(r)!;
      const agentId = reopenKeepsAgent(r) ? e.assigned_agent_id : plannedAgent(r);
      const upd = await tx.execute(
        `UPDATE pending_submission_jobs
         SET status = 'AMBER', closed_at = NULL, latest_outcome = 'REOPENED_BY_SYSTEM', assigned_agent_id = ?,
             last_seen_in_import_at = CURRENT_TIMESTAMP,
             latest_pending_reason = COALESCE(?, latest_pending_reason),
             schedule_date = COALESCE(?, schedule_date),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'GREEN'`,
        [agentId, r.latest_pending_reason, r.schedule_date, e.id]
      );
      if (upd.affectedRows === 1) {
        await tx.execute(
          `INSERT INTO pending_submission_logs (pending_submission_job_id, outcome, comment, logged_by, resulting_status)
           VALUES (?, 'REOPENED_BY_SYSTEM', 'Reappeared in a later export after being closed as absent.', 'System', 'AMBER')`,
          [e.id]
        );
        counts.reopened += 1;
        byType[r.job_type].reopened += 1;
      }
    }

    for (const m of missing) {
      const upd = await tx.execute(
        `UPDATE pending_submission_jobs
         SET status = 'GREEN', closed_at = CURRENT_TIMESTAMP, latest_outcome = 'ABSENT_FROM_LATEST_EXPORT', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'AMBER'`,
        [m.id]
      );
      if (upd.affectedRows === 1) {
        await tx.execute(
          `INSERT INTO pending_submission_logs (pending_submission_job_id, outcome, comment, logged_by, resulting_status)
           VALUES (?, 'ABSENT_FROM_LATEST_EXPORT', 'No longer present in the latest pending submissions export; assumed resolved.', 'System', 'GREEN')`,
          [m.id]
        );
        absentClosedJobIds.push(Number(m.id));
        counts.absentClosed += 1;
        byType[m.job_type].auto_closed_absent += 1;
      }
    }

    const importInsert = await tx.execute(
      `INSERT INTO pending_submission_imports (
         file_name, imported_by, row_count_total, new_records_count, skipped_open_count, skipped_closed_count, auto_closed_absent_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fileName, importedBy, rows.length, counts.added, counts.refreshed, skippedClosed, counts.absentClosed]
    );
    // Remember what this upload created and closed, so "Remove last upload" can undo it.
    await markImportRecords(tx, "pending-submissions", Number(importInsert.lastInsertId), createdJobIds, absentClosedJobIds);
  });

  await closeMaturedPendingSubmissions(db);

  // Give any open record that has no active agent (unassigned, or held by a departed agent) to the team,
  // and rebalance if the team changed. The upload is already committed, so this must never fail the upload.
  try {
    await syncPendingSubmissionAssignments(db);
  } catch (err) {
    console.error("[PENDING] Assignment sync after import failed:", err);
  }

  return {
    file_name: fileName,
    imported_by: importedBy,
    row_count_total: rows.length,
    new_records_count: counts.added,
    skipped_open_count: counts.refreshed,
    skipped_closed_count: skippedClosed,
    auto_closed_absent_count: counts.absentClosed,
    reopened_count: counts.reopened,
    invalid_rows_count: invalid.length,
    invalid_rows: invalid.slice(0, MAX_REPORTED_INVALID_ROWS),
    duplicate_in_file_count: duplicateInFile,
    type_changed_count: counts.typeChanged,
    by_type: byType,
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function getPendingSubmissionJobs(
  db: DbAdapter,
  filters: { status?: string; agent_id?: string; search?: string; company?: string; id?: number; job_type?: string } = {}
): Promise<PendingSubmissionJobView[]> {
  const settings = await getPendingSubmissionSettings(db);

  let sql = `
    SELECT
      j.id, j.external_id, j.solver_name, j.solver_contact, j.solver_contact_raw, j.solver_email,
      j.vehicle_reg, j.vehicle_reg_raw, j.insurance_company, j.client_phone, j.client_phone_raw,
      j.customer_email, j.schedule_date, j.latest_pending_reason, j.status, j.latest_outcome,
      j.assigned_agent_id, a.name AS assigned_agent_name, j.scheduled_at, j.scheduled_place,
      j.solver_notification_status, j.solver_notified_at, j.solver_notification_error,
      j.solver_notification_message, j.solver_notification_transaction_id,
      j.solver_notification_attempts, j.solver_notification_attempted_at,
      j.first_imported_at, j.last_seen_in_import_at, j.closed_at, j.created_at, j.updated_at, j.job_type, j.type_changed_at
    FROM pending_submission_jobs j
    LEFT JOIN agents a ON a.id = j.assigned_agent_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.id !== undefined) {
    sql += ` AND j.id = ?`;
    params.push(filters.id);
  }
  if (filters.status && filters.status !== "ALL") {
    sql += ` AND j.status = ?`;
    params.push(filters.status);
  }
  if (filters.agent_id && filters.agent_id !== "ALL") {
    if (filters.agent_id === "UNASSIGNED") {
      sql += ` AND j.assigned_agent_id IS NULL`;
    } else {
      sql += ` AND j.assigned_agent_id = ?`;
      params.push(Number(filters.agent_id));
    }
  }
  if (filters.company && filters.company !== "ALL") {
    sql += ` AND LOWER(TRIM(j.insurance_company)) = LOWER(TRIM(?))`;
    params.push(filters.company);
  }
  if (filters.job_type === "INSPECTION" || filters.job_type === "SUBMISSION") {
    sql += ` AND j.job_type = ?`;
    params.push(filters.job_type);
  }
  if (filters.search) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    sql += ` AND (
      LOWER(j.vehicle_reg) LIKE ? OR LOWER(j.vehicle_reg_raw) LIKE ? OR
      LOWER(j.client_phone) LIKE ? OR LOWER(j.client_phone_raw) LIKE ? OR
      LOWER(j.solver_name) LIKE ? OR LOWER(j.solver_contact) LIKE ? OR
      LOWER(j.insurance_company) LIKE ? OR CAST(j.external_id AS TEXT) LIKE ?
    )`;
    params.push(term, term, term, term, term, term, term, term);
  }
  sql += ` ORDER BY j.first_imported_at DESC, j.id DESC`;

  const rows = (await db.queryAll<any>(sql, params)).map((r) => ({
    ...r,
    id: num(r.id),
    assigned_agent_id: numOrNull(r.assigned_agent_id),
  }));
  if (rows.length === 0) return [];

  const activity = await computePendingSubmissionActivity(db, rows);
  const now = Date.now();

  return rows.map((r): PendingSubmissionJobView => {
    const act = activity.get(r.id)!;
    const firstMs = parseDbTimestamp(r.first_imported_at);
    const overdue = computeOverdue(r.status, r.schedule_date, settings.overdue_after_days, now);
    return {
      id: r.id,
      external_id: Number(r.external_id),
      solver_name: r.solver_name,
      solver_contact: r.solver_contact,
      solver_contact_raw: r.solver_contact_raw,
      solver_email: r.solver_email,
      vehicle_reg: r.vehicle_reg,
      vehicle_reg_raw: r.vehicle_reg_raw,
      insurance_company: r.insurance_company,
      client_phone: r.client_phone,
      client_phone_raw: r.client_phone_raw,
      customer_email: r.customer_email,
      schedule_date: r.schedule_date,
      latest_pending_reason: r.latest_pending_reason,
      job_type: normalizeJobType(r.job_type),
      type_changed_at: r.type_changed_at ?? null,
      status: r.status,
      latest_outcome: r.latest_outcome,
      assigned_agent_id: r.assigned_agent_id,
      assigned_agent_name: r.assigned_agent_name,
      scheduled_at: r.scheduled_at,
      scheduled_place: r.scheduled_place,
      solver_notification_status: r.solver_notification_status,
      solver_notified_at: r.solver_notified_at,
      solver_notification_error: r.solver_notification_error ?? null,
      solver_notification_message: r.solver_notification_message ?? null,
      solver_notification_transaction_id: r.solver_notification_transaction_id ?? null,
      solver_notification_attempts: Number(r.solver_notification_attempts ?? 0),
      solver_notification_attempted_at: r.solver_notification_attempted_at ?? null,
      first_imported_at: r.first_imported_at,
      last_seen_in_import_at: r.last_seen_in_import_at,
      closed_at: r.closed_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      client_attempt_count: act.client_attempt_count,
      solver_attempt_count: act.solver_attempt_count,
      last_client_attempt_at: act.last_client_attempt_at,
      client_sms_count: act.client_sms_count,
      is_overdue: overdue.is_overdue,
      days_overdue: overdue.days_overdue,
      days_pending: isNaN(firstMs) ? 0 : Math.max(0, Math.floor((now - firstMs) / DAY_MS)),
    };
  });
}

export async function getPendingSubmissionJobById(db: DbAdapter, id: number): Promise<PendingSubmissionJobView> {
  const rows = await getPendingSubmissionJobs(db, { id });
  if (rows.length === 0) throw new HttpError(404, `Record #${id} was not found.`);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Logging an outcome
// ---------------------------------------------------------------------------

export async function logPendingSubmissionOutcome(
  db: DbAdapter,
  jobId: number,
  data: { outcome?: unknown; comment?: unknown; logged_by?: unknown; scheduled_at?: unknown; scheduled_place?: unknown }
): Promise<{ success: true; job: PendingSubmissionJobView }> {
  // 400-class validation first (no database access).
  if (!Number.isInteger(jobId) || jobId <= 0) throw new HttpError(400, "Invalid record id.");
  const outcome = typeof data.outcome === "string" ? data.outcome : "";
  if (!isAgentOutcome(outcome)) throw new HttpError(400, "That outcome cannot be selected.");
  const comment = typeof data.comment === "string" ? data.comment.trim() : "";
  // The note is optional: the agent only has to record the outcome.
  if (comment.length > 2000) throw new HttpError(400, "The comment must be 2000 characters or fewer.");
  const loggedBy = (typeof data.logged_by === "string" ? data.logged_by.trim() : "").slice(0, 255) || "Agent";

  let scheduledIso: string | null = null;
  let scheduledPlace: string | null = null;
  if (outcome === "SCHEDULED") {
    // Schedule details are optional now. They are stored only when they are supplied and valid.
    if (typeof data.scheduled_at === "string" && data.scheduled_at.trim() !== "") {
      const ms = Date.parse(data.scheduled_at);
      if (isNaN(ms)) throw new HttpError(400, "The scheduled date and time is not valid.");
      scheduledIso = new Date(ms).toISOString();
    }
    if (typeof data.scheduled_place === "string" && data.scheduled_place.trim() !== "") {
      scheduledPlace = data.scheduled_place.trim();
      if (scheduledPlace.length > 500) throw new HttpError(400, "The scheduled place must be 500 characters or fewer.");
    }
  }

  const job = await db.queryOne<{ id: number; status: string; job_type: string | null }>(
    `SELECT id, status, job_type FROM pending_submission_jobs WHERE id = ?`,
    [jobId]
  );
  if (!job) throw new HttpError(404, `Record #${jobId} was not found.`);
  // SCHEDULED belongs to inspection jobs and SOLVER_SUBMITTED to submission jobs.
  if (!isAgentOutcome(outcome, normalizeJobType(job.job_type))) {
    throw new HttpError(400, "That outcome is not available for this type of job.");
  }
  if (job.status !== "AMBER") throw new HttpError(409, "This record is already closed.");

  const resultingStatus = statusForAgentOutcome(outcome);
  const closes = resultingStatus !== "AMBER";

  await db.transaction(async (tx) => {
    const upd = await tx.execute(
      `UPDATE pending_submission_jobs
       SET status = ?, latest_outcome = ?,
           scheduled_at = COALESCE(?, scheduled_at), scheduled_place = COALESCE(?, scheduled_place),
           closed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'AMBER'`,
      [resultingStatus, outcome, scheduledIso, scheduledPlace, closes ? new Date().toISOString() : null, jobId]
    );
    if (upd.affectedRows !== 1) throw new HttpError(409, "This record is already closed.");
    await tx.execute(
      `INSERT INTO pending_submission_logs (
         pending_submission_job_id, outcome, comment, logged_by, resulting_status, scheduled_at, scheduled_place
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [jobId, outcome, comment, loggedBy, resultingStatus, scheduledIso, scheduledPlace]
    );
  });

  await closeMaturedPendingSubmissions(db, { jobId });
  return { success: true, job: await getPendingSubmissionJobById(db, jobId) };
}

export async function getPendingSubmissionLogs(db: Q, jobId: number): Promise<PendingSubmissionLog[]> {
  return db.queryAll<PendingSubmissionLog>(
    `SELECT id, pending_submission_job_id, outcome, comment, logged_by, resulting_status, scheduled_at, scheduled_place, created_at
     FROM pending_submission_logs
     WHERE pending_submission_job_id = ?
     ORDER BY created_at DESC, id DESC`,
    [jobId]
  );
}

// ---------------------------------------------------------------------------
// Max attempts report
// ---------------------------------------------------------------------------

export async function getPendingSubmissionMaxAttemptsReport(
  db: DbAdapter,
  jobType?: PendingJobType
): Promise<Array<{ insurance_company: string; jobs: Array<PendingSubmissionJobView & { logs: PendingSubmissionLog[] }> }>> {
  await closeMaturedPendingSubmissions(db);
  const jobs = (await getPendingSubmissionJobs(db, { job_type: jobType })).filter(
    (j) => j.latest_outcome === "MAX_ATTEMPTS_REACHED" && j.status === "RED"
  );
  if (jobs.length === 0) return [];

  const logsByJob = new Map<number, PendingSubmissionLog[]>();
  for (let i = 0; i < jobs.length; i += 500) {
    const chunk = jobs.slice(i, i + 500);
    const logs = await db.queryAll<PendingSubmissionLog>(
      `SELECT id, pending_submission_job_id, outcome, comment, logged_by, resulting_status, scheduled_at, scheduled_place, created_at
       FROM pending_submission_logs
       WHERE pending_submission_job_id IN (${chunk.map(() => "?").join(", ")})
       ORDER BY created_at ASC, id ASC`,
      chunk.map((j) => j.id)
    );
    for (const log of logs) {
      const key = num(log.pending_submission_job_id);
      const list = logsByJob.get(key) ?? [];
      list.push({ ...log, pending_submission_job_id: key });
      logsByJob.set(key, list);
    }
  }

  const grouped = new Map<string, Array<PendingSubmissionJobView & { logs: PendingSubmissionLog[] }>>();
  for (const job of jobs) {
    const key = job.insurance_company?.trim() || "Unspecified";
    const list = grouped.get(key) ?? [];
    list.push({ ...job, logs: logsByJob.get(job.id) ?? [] });
    grouped.set(key, list);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([insurance_company, list]) => ({ insurance_company, jobs: list }));
}

// ---------------------------------------------------------------------------
// Team overview and reassignment (FIXPASS 4)
// ---------------------------------------------------------------------------

export interface PendingSubmissionTeam {
  callback_team_tag: string;
  agents: Array<{ id: number; name: string; open_count: number }>;
  unassigned_open_count: number;
  orphaned_open_count: number;
}

/** Active agents with their open load, plus open (AMBER) records nobody active is working on. */
export async function getPendingSubmissionTeam(db: Q): Promise<PendingSubmissionTeam> {
  const settings = await getPendingSubmissionSettings(db);
  const agents = await getValidSubmissionAgents(db, settings.callback_team_tag);
  const activeIds = new Set(agents.map((a) => a.id));
  const rows = await db.queryAll<{ assigned_agent_id: unknown; n: unknown }>(
    `SELECT assigned_agent_id, COUNT(*) AS n FROM pending_submission_jobs WHERE status = 'AMBER' GROUP BY assigned_agent_id`
  );
  const load = new Map<number, number>();
  let unassigned = 0;
  let orphaned = 0;
  for (const r of rows) {
    const agentId = numOrNull(r.assigned_agent_id);
    const n = num(r.n);
    if (agentId === null) unassigned += n;
    else if (activeIds.has(agentId)) load.set(agentId, n);
    else orphaned += n;
  }
  return {
    callback_team_tag: settings.callback_team_tag,
    agents: agents.map((a) => ({ id: a.id, name: a.name, open_count: load.get(a.id) ?? 0 })),
    unassigned_open_count: unassigned,
    orphaned_open_count: orphaned,
  };
}

export interface ReassignResult {
  dry_run: boolean;
  /** Open records that are (dry run) or were (real run) moved. */
  records: number;
  /** Distinct clients involved. All of a client's records go to one agent. */
  clients: number;
  /** Distinct agents that receive records. */
  agents_used: number;
}

/**
 * Redistributes OPEN (AMBER) records that are unassigned, or held by an agent who is archived or no longer
 * carries the team tag. Records held by an active tagged agent are never touched. Same algorithm as import:
 * grouped by client, sticky where an active agent already holds that client, otherwise the least loaded agent.
 */
export async function reassignOpenSubmissions(db: DbAdapter, opts: { dryRun: boolean }): Promise<ReassignResult> {
  const settings = await getPendingSubmissionSettings(db);
  const agents = await getValidSubmissionAgents(db, settings.callback_team_tag);
  if (agents.length === 0) {
    throw new HttpError(409, `No active agents carry the tag "${settings.callback_team_tag}", so there is nobody to assign records to.`);
  }
  const activeIds = new Set(agents.map((a) => a.id));

  const open = await db.queryAll<{
    id: unknown;
    client_phone: string;
    solver_contact: string;
    job_type: unknown;
    assigned_agent_id: unknown;
  }>(`SELECT id, client_phone, solver_contact, job_type, assigned_agent_id FROM pending_submission_jobs WHERE status = 'AMBER'`);
  // Each job type is shared out on its own. A customer (client for inspections, solver for submissions) is never split.
  const held: Array<{ job_type: PendingJobType; key: string; agent_id: number }> = [];
  const pool: Array<{ id: number; job_type: PendingJobType; key: string }> = [];
  for (const j of open) {
    const agentId = numOrNull(j.assigned_agent_id);
    const jobType = normalizeJobType(j.job_type);
    const key = groupKeyFor(j);
    if (agentId !== null && activeIds.has(agentId)) held.push({ job_type: jobType, key, agent_id: agentId });
    else pool.push({ id: num(j.id), job_type: jobType, key });
  }
  const plan = planAssignmentsByType(
    pool.map((r) => ({ job_type: r.job_type, key: r.key })),
    agents,
    held
  );
  const agentsUsed = new Set<number>();
  for (const v of plan.values()) if (v !== null) agentsUsed.add(v);

  const summary: ReassignResult = {
    dry_run: opts.dryRun,
    records: pool.length,
    clients: new Set(pool.map((r) => `${r.job_type}|${r.key}`)).size,
    agents_used: agentsUsed.size,
  };
  if (opts.dryRun || pool.length === 0) return summary;

  await db.transaction(async (tx) => {
    for (const r of pool) {
      const upd = await tx.execute(
        `UPDATE pending_submission_jobs SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'AMBER'`,
        [plan.get(`${r.job_type}|${r.key}`) ?? null, r.id]
      );
      if (upd.affectedRows === 1) {
        await tx.execute(
          `INSERT INTO pending_submission_logs (pending_submission_job_id, outcome, comment, logged_by, resulting_status)
           VALUES (?, 'REASSIGNED_BY_SYSTEM', 'Assigned automatically to an active team member (equal workload rule).', 'System', 'AMBER')`,
          [r.id]
        );
      }
    }
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Automatic assignment and rebalance (V16)
// ---------------------------------------------------------------------------

export interface AssignmentSyncResult {
  /** Open records that had no active agent and were given one. */
  assigned: number;
  /** Untouched open records moved to even out the workload after a team change. */
  rebalanced: number;
  /** True when the set of active team members differs from the last time this ran. */
  team_changed: boolean;
  /** True when this was the first run and the current team was only recorded as the baseline. */
  baseline_set: boolean;
}

const NO_SYNC: AssignmentSyncResult = { assigned: 0, rebalanced: 0, team_changed: false, baseline_set: false };

function teamSignature(agents: Array<{ id: number }>): string {
  return agents.map((a) => a.id).sort((a, b) => a - b).join(",");
}

/**
 * 1. Open records with no active agent (unassigned, or held by an archived or untagged agent) are given to the
 *    active team, equally by open load, one customer never split. Records held by an active agent are not touched.
 * 2. When the set of active team members has changed since the last run, untouched open records are moved from
 *    busier agents to less busy agents (see planRebalance). A record is untouched only when it has no counted call,
 *    no counted SMS and no outcome logged by a person. Worked records never move.
 * The first run only records the current team as the baseline, so deploying this does not shuffle existing work.
 * Runs are serialised inside this process. It is called on upload and when the team changes, never on a timer.
 */
let assignmentSyncChain: Promise<unknown> = Promise.resolve();

export function syncPendingSubmissionAssignments(db: DbAdapter): Promise<AssignmentSyncResult> {
  const run = assignmentSyncChain.then(
    () => runAssignmentSync(db),
    () => runAssignmentSync(db)
  );
  assignmentSyncChain = run.catch(() => undefined);
  return run;
}

async function runAssignmentSync(db: DbAdapter): Promise<AssignmentSyncResult> {
  const settings = await getPendingSubmissionSettings(db);
  const agents = await getValidSubmissionAgents(db, settings.callback_team_tag);
  if (agents.length === 0) return { ...NO_SYNC };

  const assignedResult = await reassignOpenSubmissions(db, { dryRun: false });
  const result: AssignmentSyncResult = { ...NO_SYNC, assigned: assignedResult.records };

  const signature = teamSignature(agents);
  const row = await db.queryOne<{ team_signature: string | null }>(
    `SELECT team_signature FROM pending_submission_settings WHERE id = 1`
  );
  const stored = row?.team_signature ? String(row.team_signature) : "";
  if (stored === signature) return result;

  if (stored === "") {
    await db.execute(`UPDATE pending_submission_settings SET team_signature = ? WHERE id = 1`, [signature]);
    return { ...result, baseline_set: true };
  }

  result.team_changed = true;
  if (agents.length >= 2) result.rebalanced = await rebalanceUntouchedSubmissions(db, agents);
  await db.execute(`UPDATE pending_submission_settings SET team_signature = ? WHERE id = 1`, [signature]);
  return result;
}

async function rebalanceUntouchedSubmissions(db: DbAdapter, agents: Array<{ id: number; name: string }>): Promise<number> {
  const activeIds = new Set(agents.map((a) => a.id));
  const open = (
    await db.queryAll<{
      id: unknown;
      assigned_agent_id: unknown;
      client_phone: string;
      solver_contact: string;
      vehicle_reg: string;
      first_imported_at: unknown;
      job_type: unknown;
      type_changed_at: unknown;
    }>(
      `SELECT id, assigned_agent_id, client_phone, solver_contact, vehicle_reg, first_imported_at, job_type, type_changed_at
       FROM pending_submission_jobs WHERE status = 'AMBER'`
    )
  )
    .map((r) => ({
      id: num(r.id),
      assigned_agent_id: numOrNull(r.assigned_agent_id),
      client_phone: r.client_phone,
      solver_contact: r.solver_contact,
      vehicle_reg: r.vehicle_reg,
      first_imported_at: r.first_imported_at,
      job_type: normalizeJobType(r.job_type),
      type_changed_at: r.type_changed_at,
    }))
    .filter((j) => j.assigned_agent_id !== null && activeIds.has(j.assigned_agent_id));
  if (open.length === 0) return 0;

  // Touched = any counted call or SMS by the assigned agent, or any outcome logged by a person.
  const activity = await computePendingSubmissionActivity(db, open);
  const loggedByPerson = new Set<number>(
    (
      await db.queryAll<{ pending_submission_job_id: unknown }>(
        `SELECT DISTINCT pending_submission_job_id FROM pending_submission_logs WHERE COALESCE(logged_by, '') <> 'System'`
      )
    ).map((r) => num(r.pending_submission_job_id))
  );
  const isTouched = (jobId: number) => {
    const a = activity.get(jobId);
    return (a ? a.client_attempt_count > 0 || a.client_sms_count > 0 : false) || loggedByPerson.has(jobId);
  };

  // One unit per customer per agent, kept separate for each job type (the client for inspections, the solver for submissions).
  const units = new Map<string, RebalanceUnit & { job_ids: number[]; job_type: PendingJobType }>();
  for (const j of open) {
    const key = `${j.job_type}|${groupKeyFor(j)}|${j.assigned_agent_id}`;
    const u =
      units.get(key) ?? { key, agent_id: j.assigned_agent_id as number, size: 0, movable: true, job_ids: [], job_type: j.job_type };
    u.size += 1;
    u.job_ids.push(j.id);
    if (isTouched(j.id)) u.movable = false;
    units.set(key, u);
  }

  // Each job type is balanced on its own, so the inspection work and the submission work are each shared equally.
  const moves: Array<{ key: string; from: number; to: number }> = [];
  for (const type of PENDING_JOB_TYPES) {
    moves.push(...planRebalance([...units.values()].filter((u) => u.job_type === type), agents));
  }
  if (moves.length === 0) return 0;

  let movedJobs = 0;
  await db.transaction(async (tx) => {
    for (const m of moves) {
      const unit = units.get(m.key)!;
      for (const jobId of unit.job_ids) {
        const upd = await tx.execute(
          `UPDATE pending_submission_jobs SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'AMBER' AND assigned_agent_id = ?`,
          [m.to, jobId, m.from]
        );
        if (upd.affectedRows === 1) {
          await tx.execute(
            `INSERT INTO pending_submission_logs (pending_submission_job_id, outcome, comment, logged_by, resulting_status)
             VALUES (?, 'REASSIGNED_BY_SYSTEM', 'Moved automatically to balance workload after a team change. No calls, SMS or outcomes had been logged.', 'System', 'AMBER')`,
            [jobId]
          );
          movedJobs += 1;
        }
      }
    }
  });
  return movedJobs;
}
// FIXPASS END pendingSubmissions.ts
