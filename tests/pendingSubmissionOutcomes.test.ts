// FIXPASS tests/pendingSubmissionOutcomes.test.ts
import { AGENT_OUTCOMES, SYSTEM_OUTCOMES, LEGACY_OUTCOMES, isAgentOutcome, statusForAgentOutcome } from "../pendingSubmissionOutcomes";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for pendingSubmissionOutcomes...");

assert(AGENT_OUTCOMES.length === 10, "there are exactly TEN agent outcomes");
const expected: Record<string, string> = {
  SCHEDULED: "GREEN",
  CALL_BACK: "AMBER",
  NOT_READY: "AMBER",
  NOT_PICKING: "AMBER",
  UNREACHABLE: "AMBER",
  WRONG_NUMBER: "AMBER",
  CHANGED_LOCATION: "AMBER",
  NO_DOCUMENTS: "AMBER",
  WRONG_REGISTRATION_SCHEDULE: "AMBER",
  WITHDRAWN: "RED",
};
for (const [value, status] of Object.entries(expected)) {
  assert(isAgentOutcome(value), `${value} is selectable`);
  assert(statusForAgentOutcome(value) === status, `${value} maps to ${status}`);
}
assert(AGENT_OUTCOMES.filter((o) => o.closes).length === 2, "only SCHEDULED and WITHDRAWN close a record");
for (const v of [...SYSTEM_OUTCOMES, ...LEGACY_OUTCOMES, "scheduled", " SCHEDULED", "", "CLIENT_REFUSED"]) {
  assert(!isAgentOutcome(v), `${JSON.stringify(v)} is NOT selectable by an agent`);
}
assert(!isAgentOutcome(undefined) && !isAgentOutcome(null) && !isAgentOutcome(5), "non-strings are rejected");

console.log("All pendingSubmissionOutcomes tests passed!");
// FIXPASS END tests/pendingSubmissionOutcomes.test.ts

