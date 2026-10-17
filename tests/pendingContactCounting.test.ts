// V15 tests/pendingContactCounting.test.ts
import { countClientContacts, normalizePhone } from "../pendingSubmissions";
import { hasReachedMaxAttempts } from "../insuranceCallbacks";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for the Pending Submissions contact rule...");

const ALICE = 1, BOB = 2, OUTSIDER = 99;
const team = new Set<number>([ALICE, BOB]);
const IMPORTED = "2026-10-01T00:00:00.000Z";

const job = (id: number, agent: number | null, client: string, reg: string, solver = "0700000009") => ({
  id, assigned_agent_id: agent, client_phone: normalizePhone(client), solver_contact: normalizePhone(solver), vehicle_reg: reg, first_imported_at: IMPORTED,
});
let evId = 0;
const ev = (agent: number | null, type: string, status: string | null, phone: string, ts: string, reg: string | null = null) => ({
  id: ++evId, agent_id: agent, type, status, timestamp: ts, target_phone: phone, reg_no: reg,
});
const T = (i: number) => new Date(Date.parse("2026-10-05T08:00:00.000Z") + i * 60_000).toISOString();

// Two vehicles of ONE customer (same phone), one vehicle of another customer.
const jobs = [job(1, ALICE, "0722111222", "KAA 001A"), job(2, ALICE, "0722111222", "KAA 002A"), job(3, BOB, "0733222333", "KBB 003B", "0700000008")];

const events = [
  ev(ALICE, "CALL", "OUTGOING", "+254722111222", T(1)),
  ev(ALICE, "CALL", "OUTGOING", "0722111222", T(2)),
  ev(ALICE, "CALL", "CONNECTED", "0722111222", T(3)),       // not a counted status
  ev(ALICE, "CALL", "INCOMING", "0722111222", T(4)),        // not a counted status
  ev(BOB, "CALL", "OUTGOING", "0722111222", T(5)),          // wrong agent for jobs 1 and 2
  ev(OUTSIDER, "CALL", "OUTGOING", "0722111222", T(6)),     // not on the team and not assigned
  ev(ALICE, "CALL", "OUTGOING", "0722111222", "2026-09-01T00:00:00.000Z"), // before first_imported_at
  ev(ALICE, "SMS", "SENT", "0722111222", T(7)),             // phone match: counts for BOTH of the customer's vehicles
  ev(ALICE, "SMS", "SENT", "0799000000", T(8), "kaa-002 a"),  // registration match only: counts for job 2 only
  ev(ALICE, "SMS", "SENT", "0722111222", T(9), "KAA 002A"), // phone AND registration match: still counted once
  ev(BOB, "SMS", "SENT", "0722111222", T(10)),              // wrong agent
  ev(null, "CALL", "OUTGOING", "0722111222", T(11)),        // no agent
  ev(BOB, "CALL", "OUTGOING", "0700000009", T(12)),         // call to the solver by a team agent
  ev(BOB, "CALL", "OUTGOING", "0733222333", T(13)),
];

const out = countClientContacts(jobs, events, team);
const a1 = out.get(1)!, a2 = out.get(2)!, a3 = out.get(3)!;

assert(a1.client_attempt_count === 2, `job 1 counts only the assigned agent's OUTGOING calls after import (got ${a1.client_attempt_count})`);
assert(a2.client_attempt_count === 2, "one call to a customer counts for each of that customer's vehicles");
assert(a1.client_sms_count === 2, `job 1: SMS by phone (T7) and phone+reg (T9) = 2 (got ${a1.client_sms_count})`);
assert(a2.client_sms_count === 3, `job 2: T7 phone, T8 registration only, T9 phone and registration counted once = 3 (got ${a2.client_sms_count})`);
assert(a3.client_attempt_count === 1 && a3.client_sms_count === 0, "job 3 counts Bob's own call to its client only");
assert(a3.solver_attempt_count === 0 && a1.solver_attempt_count === 1 && a2.solver_attempt_count === 1, "the solver call (0700000009) is counted for jobs whose solver number it is, by any team agent");
assert(a1.last_client_attempt_at === T(2) && a1.last_client_sms_at === T(9), "last call and last SMS times are tracked");
assert(a3.last_client_sms_at === null, "no SMS gives no last SMS time");

// Closing rule: calls AND SMS, with the configured maximums
const settings = { max_attempts: 2, max_sms_attempts: 2 };
const reached = (a: any) => hasReachedMaxAttempts({ attempt_count: a.client_attempt_count, sms_count: a.client_sms_count }, settings);
assert(reached(a1) === true && reached(a2) === true, "2 calls and 2 SMS reach a 2/2 maximum");
assert(reached(a3) === false, "1 call and 0 SMS does not");
assert(hasReachedMaxAttempts({ attempt_count: 9, sms_count: 1 }, { max_attempts: 4, max_sms_attempts: 4 }) === false, "calls alone never close a record");

// A job with no usable first_imported_at counts nothing
const bad = countClientContacts([{ ...job(7, ALICE, "0722111222", "KAA 001A"), first_imported_at: "not a date" }], events, team);
assert(bad.get(7)!.client_attempt_count === 0 && bad.get(7)!.client_sms_count === 0, "unreadable first_imported_at counts nothing");

// An unassigned job counts nothing
const unassigned = countClientContacts([job(8, null, "0722111222", "KAA 001A")], events, team);
assert(unassigned.get(8)!.client_attempt_count === 0 && unassigned.get(8)!.client_sms_count === 0, "an unassigned record has no counted activity");

// Empty input
assert(countClientContacts([], events, team).size === 0, "no jobs gives an empty map");

console.log("All Pending Submissions contact rule tests passed!");
// V15 END tests/pendingContactCounting.test.ts

