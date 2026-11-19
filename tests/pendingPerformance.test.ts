// tests/pendingPerformance.test.ts
// Date range filter, Agent conversion rate, closure rate, attempt averages and export columns for Pending Submissions.
import {
  countJobsWithoutBasisDate,
  dateRangeBoundsMs,
  dateRangeToParams,
  describeDateRange,
  isAgentConverted,
  jobInDateRange,
  parseDateRangeParams,
  pendingJobDetailColumns,
  performanceSummaryRows,
  summarizePendingPerformance,
} from "../shared/pendingPerformance";
import { computeConversion } from "../agentKpi";
import { ABSENT_CLOSE_OUTCOMES } from "../pendingSubmissionOutcomes";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for Pending performance figures...");

// ---- Date range parsing ----
assert(parseDateRangeParams({}) === null, "no dates means no range (everything included, the default)");
assert(parseDateRangeParams({ date_basis: "CLOSED" }) === null, "a basis without dates is still no range");
assert(parseDateRangeParams({ date_from: "garbage" }) === null, "invalid dates are ignored");
const r1 = parseDateRangeParams({ date_from: "2026-11-01", date_to: "2026-11-19" })!;
assert(r1.basis === "IMPORTED", "the default basis is the imported date");
const swapped = parseDateRangeParams({ date_from: "2026-11-19", date_to: "2026-11-01", date_basis: "schedule" })!;
assert(swapped.from === "2026-11-01" && swapped.to === "2026-11-19" && swapped.basis === "SCHEDULE", "reversed dates are swapped; basis is case-insensitive");
assert(parseDateRangeParams({ date_from: "2026-11-01", date_basis: "NOPE" })!.basis === "IMPORTED", "unknown basis falls back to imported date");
assert(JSON.stringify(dateRangeToParams(null)) === "{}", "no range gives no parameters");
assert(dateRangeToParams(r1).date_basis === "IMPORTED" && dateRangeToParams(r1).date_to === "2026-11-19", "range round-trips to parameters");

// ---- Nairobi day bounds (UTC+3), inclusive of the To day ----
const b = dateRangeBoundsMs(r1);
assert(b.startMs === Date.parse("2026-10-31T21:00:00Z"), "From starts at Nairobi midnight");
assert(b.endMs === Date.parse("2026-11-19T21:00:00Z"), "To includes the whole Nairobi day");
const job = (imported: string, schedule: string | null, closed: string | null) => ({ first_imported_at: imported, schedule_date: schedule, closed_at: closed });
assert(jobInDateRange(job("2026-10-31T21:00:00Z", null, null), r1), "00:00 Nairobi on the From day is inside");
assert(!jobInDateRange(job("2026-10-31T20:59:59Z", null, null), r1), "23:59 Nairobi the day before is outside");
assert(jobInDateRange(job("2026-11-19T20:59:59Z", null, null), r1), "23:59 Nairobi on the To day is inside");
assert(!jobInDateRange(job("2026-11-19T21:00:00Z", null, null), r1), "midnight after the To day is outside");
assert(jobInDateRange(job("2026-11-05 10:00:00", null, null), r1), "timestamps without a zone are read as UTC");
assert(jobInDateRange(job("2020-01-01T00:00:00Z", null, null), null), "no range includes everything");

const bySchedule = { ...r1, basis: "SCHEDULE" as const };
const byClosed = { ...r1, basis: "CLOSED" as const };
const noSchedule = job("2026-11-05T10:00:00Z", null, null);
assert(!jobInDateRange(noSchedule, bySchedule), "a job without a schedule date is outside a schedule-date range");
assert(!jobInDateRange(noSchedule, byClosed), "an open job is outside a closed-date range");
assert(jobInDateRange(job("2025-01-01T00:00:00Z", "2026-11-10T08:00:00Z", null), bySchedule), "schedule basis reads the schedule date, not the import date");
assert(jobInDateRange(job("2025-01-01T00:00:00Z", null, "2026-11-10T08:00:00Z"), byClosed), "closed basis reads the closed date");
const fromOnly = parseDateRangeParams({ date_from: "2026-11-10" })!;
assert(jobInDateRange(job("2030-01-01T00:00:00Z", null, null), fromOnly) && !jobInDateRange(job("2026-11-09T00:00:00Z", null, null), fromOnly), "open-ended range");
assert(countJobsWithoutBasisDate([noSchedule, job("x", "2026-11-10T08:00:00Z", null)], bySchedule) === 1, "jobs without the basis date are counted for the note");
assert(countJobsWithoutBasisDate([noSchedule], null) === 0, "no note without a range");
assert(describeDateRange(r1) === "Imported date: 1 Nov 2026 to 19 Nov 2026", `range description (got ${describeDateRange(r1)})`);
assert(describeDateRange(null) === "All dates", "no range description");

// ---- Agent conversion rate, closure rate, averages ----
const mk = (status: string, outcome: string | null, calls = 0, sms = 0, overdue = false) => ({
  status, latest_outcome: outcome, client_attempt_count: calls, client_sms_count: sms, is_overdue: overdue,
});
const jobs = [
  mk("GREEN", "SCHEDULED", 2, 1),               // converted: 3 attempts
  mk("GREEN", "SOLVER_SUBMITTED", 4, 1),        // converted: 5 attempts
  mk("GREEN", "ABSENT_FROM_LATEST_EXPORT", 9, 9), // closed by upload: not a conversion, not averaged
  mk("GREEN", "SUBMITTED_BY_SOLVER"),           // legacy closed by upload
  mk("RED", "WITHDRAWN", 1, 0),
  mk("RED", "MAX_ATTEMPTS_REACHED", 4, 2),
  mk("AMBER", "CALL_BACK", 1, 0, true),
  mk("AMBER", null, 0, 0, true),
  mk("AMBER", null),
  mk("AMBER", null),
];
const s = summarizePendingPerformance(jobs);
assert(s.total === 10 && s.open === 4 && s.closed === 6, "totals");
assert(s.agent_converted === 2 && s.closed_by_upload === 2 && s.closed_unsuccessful === 2 && s.max_attempts === 1 && s.overdue === 2, "breakdown");
assert(s.agent_conversion_rate === 20, `agent conversion excludes closed by upload: 2 of 10 (got ${s.agent_conversion_rate})`);
assert(s.closure_rate === 60, `closure rate includes closed by upload, withdrawn and max attempts: 6 of 10 (got ${s.closure_rate})`);
assert(s.avg_calls_per_conversion === 3 && s.avg_sms_per_conversion === 1 && s.avg_attempts_per_conversion === 4, "averages over converted jobs only");
const empty = summarizePendingPerformance([]);
assert(empty.agent_conversion_rate === null && empty.closure_rate === null && empty.avg_calls_per_conversion === null, "empty input gives n/a");
assert(isAgentConverted({ status: "GREEN", latest_outcome: "SCHEDULED" }) && !isAgentConverted({ status: "GREEN", latest_outcome: "ABSENT_FROM_LATEST_EXPORT" }), "conversion rule");
const rows = performanceSummaryRows(s, "Pending Inspection", r1);
assert(rows.find((r) => r.Measure.startsWith("Agent conversion rate"))!.Value === "20%", "summary sheet: agent conversion");
assert(rows.find((r) => r.Measure.startsWith("Closure rate"))!.Value === "60%", "summary sheet: closure rate");
assert(rows.find((r) => r.Measure === "Average calls per converted job")!.Value === 3, "summary sheet: average calls");
assert(rows.find((r) => r.Measure === "Date range")!.Value === "Imported date: 1 Nov 2026 to 19 Nov 2026", "summary sheet: date range");

// ---- Export columns ----
const cols = pendingJobDetailColumns({
  client_attempt_count: 3, client_sms_count: 2, schedule_date: "2026-11-01T07:00:00.000Z", scheduled_at: "2026-11-03T08:00:00.000Z",
  original_pending_reason: "No documents", latest_pending_reason: "Client travelling", last_outcome_at: "2026-11-02T09:00:00.000Z", closed_at: null,
});
assert(cols["Calls (Attempts)"] === 3 && cols["SMS Sent"] === 2 && cols["Total Attempts (Calls + SMS)"] === 5, "attempt columns");
assert(cols["Schedule Date (Upload)"] === "2026-11-01T07:00:00.000Z" && cols["Inspection Date (Booked by Agent)"] === "2026-11-03T08:00:00.000Z", "both dates, labelled");
assert(cols["Original Pending Reason"] === "No documents" && cols["Latest Pending Reason"] === "Client travelling", "both reasons");
assert(cols["Last Outcome Date"] === "2026-11-02T09:00:00.000Z" && cols["Closed Date"] === "", "status dates");
assert(pendingJobDetailColumns({ original_pending_reason: null })["Original Pending Reason"] === "Not recorded", "older jobs show Not recorded");

// ---- KPI panel conversion with closed-by-upload excluded (and unchanged without the exclusion) ----
const convRows = [
  { assigned_agent_id: 1, status: "GREEN", latest_outcome: "SCHEDULED", n: 2 },
  { assigned_agent_id: 1, status: "GREEN", latest_outcome: "ABSENT_FROM_LATEST_EXPORT", n: 2 },
  { assigned_agent_id: 1, status: "AMBER", latest_outcome: null, n: 4 },
];
const excluded = computeConversion(convRows, [1], ABSENT_CLOSE_OUTCOMES);
assert(excluded.overall.green === 2 && excluded.overall.total === 8 && excluded.overall.rate === 25, "agent conversion: 2 of 8");
assert(excluded.byAgent.get(1)!.rate === 25, "per agent too");
assert(computeConversion(convRows, [1]).overall.green === 4, "without exclusions every GREEN counts (Callbacks unchanged)");

console.log("All Pending performance tests passed!");
