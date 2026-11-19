// shared/pendingPerformance.ts
// Single definition of the Pending Inspection / Pending Submission performance figures and the date range filter.
// Used by the browser (tiles, Overall dashboard, list export) and the server (Agent KPI panel, Max Attempts export),
// so every number on screen matches the exports.
import { ABSENT_CLOSE_OUTCOMES } from "../pendingSubmissionOutcomes";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

/** Which date of a job the range is applied to. IMPORTED is the default. */
export type PendingDateBasis = "IMPORTED" | "SCHEDULE" | "CLOSED";
export const PENDING_DATE_BASES: ReadonlyArray<PendingDateBasis> = ["IMPORTED", "SCHEDULE", "CLOSED"];
export const DEFAULT_DATE_BASIS: PendingDateBasis = "IMPORTED";
export const DATE_BASIS_LABELS: Record<PendingDateBasis, string> = {
  IMPORTED: "Imported date",
  SCHEDULE: "Schedule date (upload)",
  CLOSED: "Closed date",
};
/** The database column each basis reads. */
export const DATE_BASIS_COLUMNS: Record<PendingDateBasis, "first_imported_at" | "schedule_date" | "closed_at"> = {
  IMPORTED: "first_imported_at",
  SCHEDULE: "schedule_date",
  CLOSED: "closed_at",
};

/** A date range in Nairobi calendar days. from and to are 'YYYY-MM-DD' and inclusive; either may be missing. */
export interface PendingDateRange {
  basis: PendingDateBasis;
  from: string | null;
  to: string | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!DAY_RE.test(text)) return null;
  return isNaN(Date.parse(`${text}T00:00:00+03:00`)) ? null : text;
}

export function parseDateBasis(value: unknown): PendingDateBasis {
  const text = String(value ?? "").trim().toUpperCase();
  return (PENDING_DATE_BASES as ReadonlyArray<string>).includes(text) ? (text as PendingDateBasis) : DEFAULT_DATE_BASIS;
}

/**
 * Reads date_from, date_to and date_basis (query parameters). Returns null when neither date is given, which means
 * "no range": every record is included, exactly as before the filter existed.
 */
export function parseDateRangeParams(query: { date_from?: unknown; date_to?: unknown; date_basis?: unknown }): PendingDateRange | null {
  let from = validDay(query.date_from);
  let to = validDay(query.date_to);
  if (!from && !to) return null;
  if (from && to && from > to) [from, to] = [to, from];
  return { basis: parseDateBasis(query.date_basis), from, to };
}

/** The range as query parameters (empty when there is no range). */
export function dateRangeToParams(range: PendingDateRange | null): Record<string, string> {
  if (!range || (!range.from && !range.to)) return {};
  const out: Record<string, string> = { date_basis: range.basis };
  if (range.from) out.date_from = range.from;
  if (range.to) out.date_to = range.to;
  return out;
}

/** Start (inclusive) and end (exclusive) instants of the range, in ms. Nairobi is UTC+3 with no daylight saving. */
export function dateRangeBoundsMs(range: PendingDateRange): { startMs: number | null; endMs: number | null } {
  return {
    startMs: range.from ? Date.parse(`${range.from}T00:00:00+03:00`) : null,
    endMs: range.to ? Date.parse(`${range.to}T00:00:00+03:00`) + DAY_MS : null,
  };
}

/** Database timestamps: Date objects, ISO strings, or 'YYYY-MM-DD HH:mm:ss' without a zone (read as UTC). */
export function timestampMs(value: unknown): number {
  if (value === null || value === undefined || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return Date.parse(s.replace(" ", "T") + "Z");
  return Date.parse(s);
}

export interface DatedJob {
  first_imported_at?: unknown;
  schedule_date?: unknown;
  closed_at?: unknown;
}

/** The job's date for the basis, in ms, or NaN when the job has no such date (no schedule date, or not closed). */
export function jobBasisMs(job: DatedJob, basis: PendingDateBasis): number {
  return timestampMs(job[DATE_BASIS_COLUMNS[basis]]);
}

/** True when there is no range, or the job's date for the basis falls inside it. A job without that date is outside. */
export function jobInDateRange(job: DatedJob, range: PendingDateRange | null): boolean {
  if (!range || (!range.from && !range.to)) return true;
  const ms = jobBasisMs(job, range.basis);
  if (isNaN(ms)) return false;
  const { startMs, endMs } = dateRangeBoundsMs(range);
  if (startMs !== null && ms < startMs) return false;
  if (endMs !== null && ms >= endMs) return false;
  return true;
}

/** Jobs left out only because they have no date for the basis (shown as a note on screen). */
export function countJobsWithoutBasisDate(jobs: DatedJob[], range: PendingDateRange | null): number {
  if (!range || (!range.from && !range.to)) return 0;
  return jobs.filter((j) => isNaN(jobBasisMs(j, range.basis))).length;
}

/** "Imported date: 1 Nov 2026 to 19 Nov 2026" (or "All dates"). */
export function describeDateRange(range: PendingDateRange | null): string {
  if (!range || (!range.from && !range.to)) return "All dates";
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  };
  const label = DATE_BASIS_LABELS[range.basis];
  if (range.from && range.to) return `${label}: ${fmt(range.from)} to ${fmt(range.to)}`;
  if (range.from) return `${label}: from ${fmt(range.from)}`;
  return `${label}: up to ${fmt(range.to!)}`;
}

// ---------------------------------------------------------------------------
// Performance figures
// ---------------------------------------------------------------------------

export interface PerformanceJob {
  status: string;
  latest_outcome: string | null;
  client_attempt_count?: number | null;
  client_sms_count?: number | null;
  is_overdue?: boolean;
}

/** A GREEN job closed because the latest upload no longer contained it, not by an agent. */
export function isClosedByUpload(job: { status: string; latest_outcome: string | null }): boolean {
  return job.status === "GREEN" && ABSENT_CLOSE_OUTCOMES.includes(job.latest_outcome ?? "");
}

/** Converted by an agent: closed GREEN (Scheduled for an inspection, Submitted for a submission) and not by an upload. */
export function isAgentConverted(job: { status: string; latest_outcome: string | null }): boolean {
  return job.status === "GREEN" && !isClosedByUpload(job);
}

/** Percentage with one decimal, or null when the denominator is 0. */
export function percent(part: number, whole: number): number | null {
  return whole <= 0 ? null : Math.round((part / whole) * 1000) / 10;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

export interface PendingPerformanceSummary {
  total: number;
  open: number;
  overdue: number;
  /** Every closed job: GREEN and RED, including jobs closed by upload, Withdrawn and Max attempts reached. */
  closed: number;
  agent_converted: number;
  closed_by_upload: number;
  closed_unsuccessful: number;
  max_attempts: number;
  /** agent_converted / total. Jobs closed by upload are not conversions. */
  agent_conversion_rate: number | null;
  /** closed / total. */
  closure_rate: number | null;
  /** Average counted calls, SMS, and calls plus SMS over the jobs an agent converted. */
  avg_calls_per_conversion: number | null;
  avg_sms_per_conversion: number | null;
  avg_attempts_per_conversion: number | null;
}

export function summarizePendingPerformance(jobs: PerformanceJob[]): PendingPerformanceSummary {
  let open = 0;
  let overdue = 0;
  let converted = 0;
  let byUpload = 0;
  let red = 0;
  let maxAttempts = 0;
  const calls: number[] = [];
  const sms: number[] = [];
  const both: number[] = [];
  for (const j of jobs) {
    if (j.status === "AMBER") open++;
    if (j.is_overdue) overdue++;
    if (j.status === "RED") red++;
    if (j.latest_outcome === "MAX_ATTEMPTS_REACHED") maxAttempts++;
    if (isClosedByUpload(j)) byUpload++;
    else if (isAgentConverted(j)) {
      converted++;
      const c = Number(j.client_attempt_count ?? 0) || 0;
      const s = Number(j.client_sms_count ?? 0) || 0;
      calls.push(c);
      sms.push(s);
      both.push(c + s);
    }
  }
  const total = jobs.length;
  const closed = total - open;
  return {
    total,
    open,
    overdue,
    closed,
    agent_converted: converted,
    closed_by_upload: byUpload,
    closed_unsuccessful: red,
    max_attempts: maxAttempts,
    agent_conversion_rate: percent(converted, total),
    closure_rate: percent(closed, total),
    avg_calls_per_conversion: average(calls),
    avg_sms_per_conversion: average(sms),
    avg_attempts_per_conversion: average(both),
  };
}

// ---------------------------------------------------------------------------
// Export columns shared by the list export and the Max Attempts export
// ---------------------------------------------------------------------------

/** Text shown for a missing original reason: jobs created before it was recorded. */
export const ORIGINAL_REASON_NOT_RECORDED = "Not recorded";

export interface DetailJob {
  client_attempt_count?: number | null;
  client_sms_count?: number | null;
  schedule_date?: string | null;
  scheduled_at?: string | null;
  original_pending_reason?: string | null;
  latest_pending_reason?: string | null;
  last_outcome_at?: string | null;
  closed_at?: string | null;
}

/** Attempts, dates and reasons of one job, with clearly labelled column names. */
export function pendingJobDetailColumns(j: DetailJob): Record<string, string | number> {
  const calls = Number(j.client_attempt_count || 0) || 0;
  const sms = Number(j.client_sms_count || 0) || 0;
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v instanceof Date ? v.toISOString() : v));
  return {
    "Calls (Attempts)": calls,
    "SMS Sent": sms,
    "Total Attempts (Calls + SMS)": calls + sms,
    "Schedule Date (Upload)": text(j.schedule_date),
    "Inspection Date (Booked by Agent)": text(j.scheduled_at),
    "Original Pending Reason": j.original_pending_reason ? String(j.original_pending_reason) : ORIGINAL_REASON_NOT_RECORDED,
    "Latest Pending Reason": text(j.latest_pending_reason),
    "Last Outcome Date": text(j.last_outcome_at),
    "Closed Date": text(j.closed_at),
  };
}

/** Rows of the Summary sheet of the list export: the performance figures of the exported jobs. */
export function performanceSummaryRows(summary: PendingPerformanceSummary, scope: string, range: PendingDateRange | null): Array<{ Measure: string; Value: string | number }> {
  const pct = (v: number | null) => (v === null ? "n/a" : `${v}%`);
  const avg = (v: number | null) => (v === null ? "n/a" : v);
  return [
    { Measure: "Scope", Value: scope },
    { Measure: "Date range", Value: describeDateRange(range) },
    { Measure: "Total jobs", Value: summary.total },
    { Measure: "Open", Value: summary.open },
    { Measure: "Closed (all)", Value: summary.closed },
    { Measure: "Converted by agent", Value: summary.agent_converted },
    { Measure: "Closed by upload", Value: summary.closed_by_upload },
    { Measure: "Closed unsuccessful", Value: summary.closed_unsuccessful },
    { Measure: "Agent conversion rate (converted by agent / total)", Value: pct(summary.agent_conversion_rate) },
    { Measure: "Closure rate (all closed / total)", Value: pct(summary.closure_rate) },
    { Measure: "Average calls per converted job", Value: avg(summary.avg_calls_per_conversion) },
    { Measure: "Average SMS per converted job", Value: avg(summary.avg_sms_per_conversion) },
    { Measure: "Average attempts (calls + SMS) per converted job", Value: avg(summary.avg_attempts_per_conversion) },
  ];
}
