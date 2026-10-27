// V19 tests/pendingJobTypes.test.ts
import {
  ABSENT_CLOSE_OUTCOMES,
  AGENT_OUTCOMES,
  SUBMISSION_OUTCOMES,
  SYSTEM_OUTCOMES,
  isAgentOutcome,
  normalizeJobType,
  outcomesFor,
  parseJobStatus,
  parseJobTypeParam,
  statusForAgentOutcome,
} from "../pendingSubmissionOutcomes";
import { countClientContacts, countingStartMs, normalizePhone, primaryPhoneOf } from "../pendingSubmissions";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for Pending Submissions job types...");

// ---- job_status cell ----
assert(parseJobStatus("Pending Inspection") === "INSPECTION", "Pending Inspection is an inspection job");
assert(parseJobStatus("Pending Submission") === "SUBMISSION", "Pending Submission is a submission job");
assert(parseJobStatus("  pending   inspection ") === "INSPECTION", "case and spacing are forgiven");
assert(parseJobStatus("PENDING_SUBMISSION") === "SUBMISSION", "underscores are forgiven");
for (const bad of ["", "   ", "Inspection", "Submission", "Pending", "Pending Inspection Now", "Pending Valuation", null, undefined, 5]) {
  assert(parseJobStatus(bad) === null, `${JSON.stringify(bad)} is not recognised`);
}
assert(normalizeJobType("SUBMISSION") === "SUBMISSION", "SUBMISSION stays");
assert(normalizeJobType("INSPECTION") === "INSPECTION" && normalizeJobType(undefined) === "INSPECTION" && normalizeJobType("x") === "INSPECTION", "everything else is an inspection job");
assert(parseJobTypeParam("submission") === "SUBMISSION" && parseJobTypeParam("INSPECTION") === "INSPECTION", "the query parameter is read");
assert(parseJobTypeParam("ALL") === undefined && parseJobTypeParam(undefined) === undefined && parseJobTypeParam("") === undefined, "anything else means no filter");

// ---- outcomes ----
assert(AGENT_OUTCOMES.length === 10 && SUBMISSION_OUTCOMES.length === 10, "each stream has exactly ten outcomes");
assert(AGENT_OUTCOMES.some((o) => o.value === "SCHEDULED") && !AGENT_OUTCOMES.some((o) => o.value === "SOLVER_SUBMITTED"), "inspection has Scheduled, not Submitted");
assert(SUBMISSION_OUTCOMES[0].value === "SOLVER_SUBMITTED" && SUBMISSION_OUTCOMES[0].label === "Submitted", "submission starts with Submitted");
assert(!SUBMISSION_OUTCOMES.some((o) => o.value === "SCHEDULED"), "submission has no Scheduled");
assert(SUBMISSION_OUTCOMES.filter((o) => o.closes).map((o) => o.value).sort().join() === "SOLVER_SUBMITTED,WITHDRAWN", "only Submitted and Withdrawn close a submission job");
assert(statusForAgentOutcome("SOLVER_SUBMITTED") === "GREEN", "Submitted closes GREEN");
assert(statusForAgentOutcome("SCHEDULED") === "GREEN", "Scheduled still closes GREEN");
assert(isAgentOutcome("SCHEDULED", "INSPECTION") && !isAgentOutcome("SCHEDULED", "SUBMISSION"), "Scheduled only for inspection");
assert(isAgentOutcome("SOLVER_SUBMITTED", "SUBMISSION") && !isAgentOutcome("SOLVER_SUBMITTED", "INSPECTION"), "Submitted only for submission");
assert(isAgentOutcome("NO_DOCUMENTS", "SUBMISSION") && isAgentOutcome("NO_DOCUMENTS", "INSPECTION"), "the other nine are shared");
assert(isAgentOutcome("SOLVER_SUBMITTED") && isAgentOutcome("SCHEDULED"), "without a type either list is accepted");
assert(outcomesFor("SUBMISSION") === SUBMISSION_OUTCOMES && outcomesFor("INSPECTION") === AGENT_OUTCOMES, "outcomesFor returns the right list");
assert(!ABSENT_CLOSE_OUTCOMES.includes("SOLVER_SUBMITTED"), "a job an agent closed as submitted is never reopened by an upload");
assert(SYSTEM_OUTCOMES.includes("TYPE_CHANGED_BY_SYSTEM") && !isAgentOutcome("TYPE_CHANGED_BY_SYSTEM"), "the type change marker is system only");

// ---- primary contact and counting start ----
assert(primaryPhoneOf({ job_type: "SUBMISSION", client_phone: "722111222", solver_contact: "711000111" }) === "711000111", "submission uses the solver number");
assert(primaryPhoneOf({ job_type: "INSPECTION", client_phone: "722111222", solver_contact: "711000111" }) === "722111222", "inspection uses the client number");
assert(primaryPhoneOf({ client_phone: "722111222", solver_contact: "711000111" }) === "722111222", "no type means inspection");
assert(countingStartMs({ first_imported_at: "2026-10-01T00:00:00.000Z" }) === Date.parse("2026-10-01T00:00:00.000Z"), "counting starts at the first import");
assert(countingStartMs({ first_imported_at: "2026-10-01T00:00:00.000Z", type_changed_at: "2026-10-10T00:00:00.000Z" }) === Date.parse("2026-10-10T00:00:00.000Z"), "a type change restarts counting");
assert(countingStartMs({ first_imported_at: "2026-10-10T00:00:00.000Z", type_changed_at: "2026-10-01T00:00:00.000Z" }) === Date.parse("2026-10-10T00:00:00.000Z"), "an older type change never moves the start back");
assert(isNaN(countingStartMs({ first_imported_at: "garbage" })), "an unreadable import time stays unreadable");

// ---- counting ----
const ALICE = 1;
const team = new Set<number>([ALICE]);
const IMPORTED = "2026-10-01T00:00:00.000Z";
const T = (i: number) => new Date(Date.parse("2026-10-05T08:00:00.000Z") + i * 60_000).toISOString();
let evId = 0;
const ev = (type: string, status: string | null, phone: string, ts: string, reg: string | null = null) => ({
  id: ++evId, agent_id: ALICE, type, status, timestamp: ts, target_phone: phone, reg_no: reg,
});
const CLIENT = "0722111222", SOLVER = "0711000111";
const mk = (id: number, type: string, reg: string, extra: Record<string, unknown> = {}) => ({
  id, assigned_agent_id: ALICE, client_phone: normalizePhone(CLIENT), solver_contact: normalizePhone(SOLVER), vehicle_reg: reg, first_imported_at: IMPORTED, job_type: type, ...extra,
});
const jobs = [mk(1, "SUBMISSION", "KAA 001A"), mk(2, "SUBMISSION", "KAA 002A"), mk(3, "INSPECTION", "KBB 003B")];
const events = [
  ev("CALL", "OUTGOING", SOLVER, T(1)),
  ev("CALL", "OUTGOING", "+254711000111", T(2)),
  ev("CALL", "OUTGOING", CLIENT, T(3)),                       // the client: counts for the inspection job only
  ev("CALL", "INCOMING", SOLVER, T(4)),                       // not a counted status
  ev("SMS", "SENT", SOLVER, T(5)),
  ev("SMS", "SENT", "0799000000", T(6), "KAA 002A"),          // registration match
  ev("CALL", "OUTGOING", "0700999888", T(7)),                 // a broker: never counted
];
const out = countClientContacts(jobs, events, team);
assert(out.get(1)!.client_attempt_count === 2, `submission job counts the two solver calls (got ${out.get(1)!.client_attempt_count})`);
assert(out.get(2)!.client_attempt_count === 2, "the solver's call counts for each of the solver's vehicles");
assert(out.get(1)!.client_sms_count === 1 && out.get(2)!.client_sms_count === 2, "solver SMS counts, a registration SMS counts for its own vehicle");
assert(out.get(3)!.client_attempt_count === 1, "the inspection job counts the client call only");
assert(out.get(3)!.client_sms_count === 0, "an SMS to the solver number is not counted for an inspection job");

// ---- a type change restarts counting ----
const changed = [mk(4, "SUBMISSION", "KCC 004C", { type_changed_at: T(3) })];
const out2 = countClientContacts(changed, events, team);
assert(out2.get(4)!.client_attempt_count === 0, "solver calls made before the type change are not counted after it");
const later = [ev("CALL", "OUTGOING", SOLVER, T(10)), ev("CALL", "OUTGOING", SOLVER, T(11))];
const out3 = countClientContacts(changed, [...events, ...later], team);
assert(out3.get(4)!.client_attempt_count === 2, "solver calls after the type change are counted");

console.log("All job type tests passed!");
// V19 END tests/pendingJobTypes.test.ts
