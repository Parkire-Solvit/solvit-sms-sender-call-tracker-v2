// FIXPASS tests/pendingSubmissionsCore.test.ts
import {
  planAssignments,
  computeOverdue,
  validateSolverSmsTemplate,
  parseDbTimestamp,
  normalizePhone,
  normalizeVehicleReg,
} from "../pendingSubmissions";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for pendingSubmissions core (pure functions)...");

// normalisation
assert(normalizePhone("+254 722 123 456") === "722123456", "phone: +254 form");
assert(normalizePhone("0722123456") === "722123456", "phone: 07 form");
assert(normalizeVehicleReg("kdv  235f") === "KDV235F", "reg: uppercase and strip whitespace");

// parseDbTimestamp
assert(parseDbTimestamp("2026-10-15 10:00:00") === Date.parse("2026-10-15T10:00:00Z"), "SQLite timestamp is UTC");
assert(parseDbTimestamp("2026-10-15T10:00:00+03:00") === Date.parse("2026-10-15T07:00:00Z"), "offset respected");
assert(parseDbTimestamp(new Date("2026-10-15T10:00:00Z")) === Date.parse("2026-10-15T10:00:00Z"), "Date object");
assert(isNaN(parseDbTimestamp(null)) && isNaN(parseDbTimestamp("garbage")), "invalid is NaN");

// planAssignments
const agents = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];
const p1 = planAssignments(
  [
    { client_phone: "111", count: 2 },
    { client_phone: "222", count: 1 },
    { client_phone: "333", count: 1 },
  ],
  agents,
  new Map(),
  new Map()
);
assert(p1.get("111") === 1, "largest group goes to first agent by name on a tie");
assert(p1.get("222") === 2 && p1.get("333") === 2, "remaining singles go to the lighter agent");
assert(p1.size === 3, "one entry per client: a client is never split");

const p2 = planAssignments([{ client_phone: "444", count: 1 }], agents, new Map([[1, 5], [2, 0]]), new Map());
assert(p2.get("444") === 2, "agent with fewer open jobs is chosen");

const p3 = planAssignments([{ client_phone: "555", count: 1 }], agents, new Map([[1, 5], [2, 0]]), new Map([["555", 1]]));
assert(p3.get("555") === 1, "sticky client keeps its existing agent even if busier");

const p4 = planAssignments([{ client_phone: "666", count: 1 }], agents, new Map(), new Map([["666", 99]]));
assert(p4.get("666") === 1, "sticky agent that is no longer active is ignored");

const p5 = planAssignments([{ client_phone: "777", count: 3 }], [], new Map(), new Map());
assert(p5.get("777") === null, "no active agents means unassigned");

// computeOverdue
const now = Date.parse("2026-10-15T12:00:00Z");
const d = (days: number) => new Date(now - days * 86_400_000).toISOString();
assert(computeOverdue("AMBER", d(2), 3, now).is_overdue === false, "2 days old, threshold 3: not overdue");
assert(computeOverdue("AMBER", d(3), 3, now).is_overdue === false, "exactly at threshold: not overdue");
const o = computeOverdue("AMBER", new Date(now - 3 * 86_400_000 - 1).toISOString(), 3, now);
assert(o.is_overdue === true && o.days_overdue === 1, "just past threshold: overdue by 1 day");
assert(computeOverdue("AMBER", d(10), 3, now).days_overdue === 7, "10 days old, threshold 3: 7 days overdue");
assert(computeOverdue("GREEN", d(10), 3, now).is_overdue === false, "closed records are never overdue");
assert(computeOverdue("AMBER", null, 3, now).is_overdue === false, "null schedule_date is never overdue");
assert(computeOverdue("AMBER", "not a date", 3, now).is_overdue === false, "invalid schedule_date is never overdue");

// template validation
const ok = "Hi {solver_name}, inspection for {vehicle_reg} is scheduled for {scheduled_at} at {scheduled_place}.";
assert(validateSolverSmsTemplate(ok) === null, "default template is valid");
assert(validateSolverSmsTemplate(ok + " Call {client_phone}") === null, "optional placeholder allowed");
assert(validateSolverSmsTemplate("") !== null, "empty rejected");
assert(validateSolverSmsTemplate(ok + " {bogus}") !== null, "unknown placeholder rejected");
assert(validateSolverSmsTemplate("{vehicle_reg} {scheduled_at}") !== null, "missing required placeholder rejected");
assert(validateSolverSmsTemplate(ok + "x".repeat(500)) !== null, "over 480 characters rejected");

console.log("All pendingSubmissions core tests passed!");
// FIXPASS END tests/pendingSubmissionsCore.test.ts

