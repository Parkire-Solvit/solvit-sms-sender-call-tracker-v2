// V15 tests/submissionQueue.test.ts
import { scheduleMs, compareOldestFirst, groupByCustomerOldestFirst } from "../src/lib/submissionQueue";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for submissionQueue...");

const rec = (external_id: number, client_phone: string, schedule_date: string | null) => ({ external_id, client_phone, schedule_date });

// scheduleMs
assert(scheduleMs(null) === Infinity && scheduleMs("") === Infinity && scheduleMs("garbage") === Infinity, "missing or unreadable dates are Infinity");
assert(scheduleMs("2026-10-01T08:30:00.000Z") === Date.parse("2026-10-01T08:30:00.000Z"), "ISO date is read as given");
assert(scheduleMs("2026-10-01 08:30:00") === Date.parse("2026-10-01T08:30:00Z"), "date with no timezone is read as UTC");

// compareOldestFirst
const sorted = [rec(3, "a", "2026-10-03T00:00:00Z"), rec(1, "b", null), rec(2, "c", "2026-09-01T00:00:00Z"), rec(5, "d", "2026-10-03T00:00:00Z")].sort(compareOldestFirst);
assert(sorted.map((r) => r.external_id).join(",") === "2,3,5,1", `oldest first, ties by id, undated last (got ${sorted.map((r) => r.external_id).join(",")})`);

// groupByCustomerOldestFirst: a customer with two vehicles stays together, placed by the OLDEST vehicle
const groups = groupByCustomerOldestFirst([
  rec(10, "722000001", "2026-10-05T00:00:00Z"), // customer A, newer vehicle
  rec(11, "722000002", "2026-09-20T00:00:00Z"), // customer B
  rec(12, "722000001", "2026-09-01T00:00:00Z"), // customer A, oldest vehicle overall
  rec(13, "722000003", null),                   // customer C, undated
  rec(14, "722000004", "2026-09-20T00:00:00Z"), // customer D, same date as B, higher id
]);
assert(groups.map((g) => g.client_phone).join(",") === "722000001,722000002,722000004,722000003", `customer order (got ${groups.map((g) => g.client_phone).join(",")})`);
assert(groups[0].records.map((r) => r.external_id).join(",") === "12,10", "inside a customer, vehicles are oldest first");
assert(groups[0].records.length === 2, "all of a customer's vehicles are in one group");
assert(groups[3].oldest_schedule_ms === Infinity, "an undated customer has an infinite sort key and is last");
assert(groupByCustomerOldestFirst([]).length === 0, "empty input gives no groups");

// input is not mutated
const input = [rec(2, "x", "2026-10-02T00:00:00Z"), rec(1, "x", "2026-10-01T00:00:00Z")];
groupByCustomerOldestFirst(input);
assert(input[0].external_id === 2, "the input array is not reordered");

console.log("All submissionQueue tests passed!");
// V15 END tests/submissionQueue.test.ts

