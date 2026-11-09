// tests/callbackOrder.test.ts
// Callbacks are ordered oldest first: partners by their oldest job, then customers, then vehicles.
import { parseCallbackDateMs, callbackReferenceMs, compareCallbacksOldestFirst, sortCallbacksNewestFirst, sortCallbacksOldestFirst } from "../src/lib/callbackOrder";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for callbackOrder...");

// Date reading
assert(parseCallbackDateMs(null) === Infinity && parseCallbackDateMs("") === Infinity && parseCallbackDateMs("garbage") === Infinity, "missing or unreadable dates are Infinity");
assert(parseCallbackDateMs("2026-09-01") === Date.parse("2026-09-01"), "an ISO date is read as given");
assert(parseCallbackDateMs("01/10/2026") === Date.UTC(2026, 9, 1), "01/10/2026 is 1 October (day first)");
assert(parseCallbackDateMs("13/10/2026") === Date.UTC(2026, 9, 13), "13/10/2026 is 13 October");
assert(parseCallbackDateMs("05-02-2026") === Date.UTC(2026, 1, 5), "dashes are read day first too");
assert(parseCallbackDateMs(new Date("2026-03-04T00:00:00Z")) === Date.UTC(2026, 2, 4), "a Date object is read");
assert(callbackReferenceMs({ initiated_date: null, created_at: "2026-02-02T00:00:00Z" }) === Date.parse("2026-02-02T00:00:00Z"), "falls back to the created date");
assert(callbackReferenceMs({ initiated_date: null, created_at: null }) === Infinity, "no date at all is Infinity");

const job = (id: number, partner: string | null, phone: string, initiated: string | null, created: unknown = "2026-12-01T00:00:00Z") => ({
  id, channel_partner: partner, client_phone: phone, initiated_date: initiated, created_at: created,
});

// Plain ordering
const sorted = [job(3, "A", "1", "2026-10-03"), job(1, "A", "1", null, null), job(2, "A", "1", "2026-09-01"), job(5, "A", "1", "2026-10-03")].sort(compareCallbacksOldestFirst);
assert(sorted.map((j) => j.id).join(",") === "2,3,5,1", `oldest first, ties by id, undated last (got ${sorted.map((j) => j.id).join(",")})`);

// Partner, customer, vehicle structure
const jobs = [
  job(10, "Alpha", "700000001", "2026-10-05"),  // Alpha customer 1, newer vehicle
  job(11, "Alpha", "700000001", "2026-10-02"),  // Alpha customer 1, older vehicle
  job(12, "Alpha", "700000002", "2026-09-30"),  // Alpha customer 2: older than customer 1
  job(20, "Zulu", "700000009", "2026-08-01"),   // Zulu holds the oldest job of all
  job(30, "Mike", "700000005", "2026-09-15"),
  job(31, null, "700000006", "2026-09-20"),     // no partner: shown as Unassigned Partner
  job(32, "Mike", "700000007", null, null),     // undated: last inside Mike
];
const out = sortCallbacksOldestFirst(jobs);
assert(out.map((j) => j.id).join(",") === "20,30,32,31,12,11,10" || out.map((j) => j.id).join(",") === "20,30,32,12,11,10,31", `unexpected order ${out.map((j) => j.id).join(",")}`);
// Partners ordered by their oldest job: Zulu (Aug 1), Mike (Sep 15), Unassigned Partner (Sep 20), Alpha (Sep 30)
const partnersInOrder = out.map((j) => j.channel_partner ?? "Unassigned Partner").filter((p, i, a) => a.indexOf(p) === i);
assert(partnersInOrder.join(",") === "Zulu,Mike,Unassigned Partner,Alpha", `partners by oldest job (got ${partnersInOrder.join(",")})`);
assert(out.map((j) => j.id).join(",") === "20,30,32,31,12,11,10", `full order (got ${out.map((j) => j.id).join(",")})`);
// Inside Alpha: customer 2 (oldest 30 Sep) before customer 1 (oldest 2 Oct), and customer 1's vehicles oldest first.
const alpha = out.filter((j) => j.channel_partner === "Alpha").map((j) => j.id).join(",");
assert(alpha === "12,11,10", `inside a partner: customers by oldest job, vehicles oldest first (got ${alpha})`);

// Partner groups stay together (never interleaved)
const seen: string[] = [];
for (const j of out) {
  const p = j.channel_partner ?? "Unassigned Partner";
  if (seen[seen.length - 1] !== p) {
    assert(!seen.includes(p), `partner ${p} appears in one block only`);
    seen.push(p);
  }
}

// Input is not changed, empty input is safe, and a partner with only undated jobs goes last
const copy = [...jobs];
sortCallbacksOldestFirst(jobs);
assert(JSON.stringify(copy) === JSON.stringify(jobs), "the input array is not reordered");
assert(sortCallbacksOldestFirst([]).length === 0, "empty input gives an empty list");
const undatedPartner = sortCallbacksOldestFirst([job(1, "Undated", "7", null, null), job(2, "Dated", "8", "2026-01-01")]);
assert(undatedPartner[0].channel_partner === "Dated", "a partner with only undated jobs goes last");

const newest = sortCallbacksNewestFirst([
  { ...job(1, "Older Partner", "1", "2026-11-01"), first_imported_at: "2026-11-02T08:00:00Z" },
  { ...job(2, "New Partner", "2", "2026-10-01"), first_imported_at: "2026-11-08T08:00:00Z" },
  { ...job(3, "New Partner", "3", "2026-09-01"), first_imported_at: "2026-11-09T08:00:00Z" },
  { ...job(4, "New Partner", "2", "2026-08-01"), first_imported_at: "2026-11-07T08:00:00Z" },
]);
assert(newest.map((j) => j.id).join(",") === "3,2,4,1", `new additions and their groups appear first (got ${newest.map((j) => j.id).join(",")})`);

console.log("All callbackOrder tests passed!");
