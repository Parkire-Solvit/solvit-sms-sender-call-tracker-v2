// tests/conversionRate.test.ts
// Conversion rate for Pending Inspection and Pending Submission: all GREEN records over all records.
import { computeConversion, conversionStat } from "../agentKpi";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for conversion rate...");

assert(conversionStat(0, 0).rate === null, "no records gives no rate");
assert(conversionStat(0, 5).rate === 0, "no green records gives 0%");
assert(conversionStat(5, 5).rate === 100, "all green gives 100%");
assert(conversionStat(1, 3).rate === 33.3, "rate has one decimal");
assert(conversionStat(2, 3).rate === 66.7, "rate rounds to one decimal");

// Mary holds 10 jobs (4 green, 3 red, 3 open). Kelvin holds 2 (1 green, 1 open). 2 jobs belong to nobody (1 green).
const rows = [
  { assigned_agent_id: 1, status: "GREEN", n: 4 },
  { assigned_agent_id: 1, status: "RED", n: 3 },
  { assigned_agent_id: 1, status: "AMBER", n: 3 },
  { assigned_agent_id: 2, status: "GREEN", n: 1 },
  { assigned_agent_id: 2, status: "AMBER", n: 1 },
  { assigned_agent_id: null, status: "GREEN", n: 1 },
  { assigned_agent_id: null, status: "RED", n: 1 },
];
const { overall, byAgent } = computeConversion(rows, [1, 2, 3]);
assert(overall.green === 6 && overall.total === 14 && overall.rate === 42.9, `overall counts every record, even unassigned ones (got ${JSON.stringify(overall)})`);
assert(byAgent.get(1)!.green === 4 && byAgent.get(1)!.total === 10 && byAgent.get(1)!.rate === 40, "Mary: 4 of 10");
assert(byAgent.get(2)!.green === 1 && byAgent.get(2)!.total === 2 && byAgent.get(2)!.rate === 50, "Kelvin: 1 of 2");
assert(byAgent.get(3)!.total === 0 && byAgent.get(3)!.rate === null, "an agent with no records is listed with no rate");
assert(computeConversion([], []).overall.rate === null, "empty input is safe");

// Counts may arrive as text from the database driver.
const text = computeConversion([{ assigned_agent_id: 1, status: "GREEN", n: "3" as unknown as number }, { assigned_agent_id: 1, status: "AMBER", n: "1" as unknown as number }], [1]);
assert(text.byAgent.get(1)!.rate === 75, "numeric strings are read as numbers");

console.log("All conversion rate tests passed!");
