// V15 tests/agentKpi.test.ts
import { computeAgentKpis, computeAgentPace, lookbackStartMs, describeFinish, KpiRecord } from "../agentKpi";
import { DEFAULT_WORKING_HOURS, WorkingHoursSchedule } from "../src/types/compliance";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for the agent KPI and pace advisor...");

const DAY = 86_400_000;
// Wednesday 14 October 2026, 11:00 Nairobi time (08:00 UTC)
const NOW = Date.parse("2026-10-14T08:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const A = 1, B = 2;
const req = { calls: 4, sms: 4 };

const rec = (agent: number | null, customer: string, status: "AMBER" | "GREEN" | "RED", calls: number, sms: number, extra: Partial<KpiRecord> = {}): KpiRecord => ({
  agent_id: agent, customer_key: customer, status, closed_by_upload: false, closed_at: status === "AMBER" ? null : ago(1), reference_at: ago(2), calls, sms, ...extra,
});

// ---------- KPI ----------
const records: KpiRecord[] = [
  rec(A, "c1", "AMBER", 4, 0, { reference_at: ago(10) }), // customer c1, vehicle 1: calls done, no SMS
  rec(A, "c1", "AMBER", 4, 2),                              // customer c1, vehicle 2
  rec(A, "c2", "AMBER", 0, 0),                              // never contacted
  rec(A, "c3", "AMBER", 4, 4),                              // at target but still open (grace period)
  rec(A, "c4", "RED", 4, 4),                                // completed inside the window
  rec(A, "c5", "GREEN", 1, 0, { closed_at: ago(40) }),      // completed, but outside the 30 day window
  rec(A, "c6", "GREEN", 0, 0, { closed_by_upload: true }),  // closed by an upload inside the window
  rec(A, "c7", "GREEN", 0, 0, { closed_by_upload: true, closed_at: ago(45) }), // closed by an upload, outside the window
  rec(null, "c8", "AMBER", 0, 0),                           // unassigned open
  rec(99, "c9", "AMBER", 1, 1),                             // assigned to someone who is not on the team
  rec(null, "c10", "GREEN", 0, 0),                          // closed and unassigned: ignored
];
const out = computeAgentKpis(records, [{ id: A, name: "Alice" }, { id: B, name: "Bob" }], req, NOW);
const a = out.agents[0], b = out.agents[1];

assert(a.agent_name === "Alice" && b.agent_name === "Bob" && out.agents.length === 2, "one entry per team agent, in the given order");
assert(a.open === 4, `Alice has 4 open records (got ${a.open})`);
assert(a.never_contacted === 1 && a.below_target === 2 && a.at_target_open === 1, `exception counts (got ${a.never_contacted}/${a.below_target}/${a.at_target_open})`);
assert(a.never_contacted + a.below_target + a.at_target_open === a.open, "the three open classes add up to open");
assert(a.completed === 1, `only the RED record closed inside the window is completed (got ${a.completed})`);
assert(a.closed_by_upload === 1, `only the upload closure inside the window is counted (got ${a.closed_by_upload})`);
assert(a.in_scope === 5, `in_scope = open + completed = 5 (got ${a.in_scope})`);
assert(a.completion_rate === 20, `completion rate is 1/5 = 20.0 (got ${a.completion_rate})`);
assert(a.all_clear === false, "not all clear while records are open");
assert(a.open_customers === 3, `three open customers (got ${a.open_customers})`);
assert(a.calls_remaining === 4, `calls remaining: c1 0 (shared), c2 4, c3 0 = 4 (got ${a.calls_remaining})`);
assert(a.sms_remaining === 8, `sms remaining: c1 max(4,2) = 4, c2 4, c3 0 = 8 (got ${a.sms_remaining})`);
assert(a.oldest_open_days === 10, `oldest open record is 10 days old (got ${a.oldest_open_days})`);
assert(b.in_scope === 0 && b.completion_rate === null && b.all_clear === true && b.oldest_open_days === null, "an agent with no records has no rate and is all clear");
assert(out.unassigned_open === 2, `two open records belong to nobody on the team (got ${out.unassigned_open})`);

// completion of 100 percent
const perfect = computeAgentKpis([rec(A, "x", "GREEN", 2, 2), rec(A, "y", "RED", 4, 4)], [{ id: A, name: "Alice" }], req, NOW);
assert(perfect.agents[0].completion_rate === 100 && perfect.agents[0].all_clear === true, "all closed gives 100 percent and all clear");

// ---------- lookback window ----------
// Working days back from Wed 14 Oct: Wed, Tue, Mon, (Sun is off), Sat, Fri -> window starts Fri 9 Oct 00:00 Nairobi
assert(lookbackStartMs(NOW, DEFAULT_WORKING_HOURS, "working_hours") === Date.parse("2026-10-08T21:00:00.000Z"), "5 working day lookback starts at Nairobi midnight on Fri 9 Oct");
assert(lookbackStartMs(NOW, DEFAULT_WORKING_HOURS, "continuous_24_7") === NOW - 5 * DAY, "continuous clock uses 5 x 24 hours");
const noDays: WorkingHoursSchedule = JSON.parse(JSON.stringify(DEFAULT_WORKING_HOURS));
for (const k of Object.keys(noDays) as Array<keyof WorkingHoursSchedule>) noDays[k].enabled = false;
assert(lookbackStartMs(NOW, noDays, "working_hours") === null, "a schedule with no working days has no lookback");

// ---------- pace ----------
// Working time since Fri 9 Oct 00:00: Fri 8h + Sat 3h + Mon 8h + Tue 8h + Wed 09:00-11:00 2h = 29 hours.
const lookStart = Date.parse("2026-10-08T21:00:00.000Z");
const callsLookback = Array.from({ length: 58 }, (_, i) => lookStart + 10 * 3_600_000 + i * 60_000); // 58 calls inside the window, all before today
const todayCalls = [Date.parse("2026-10-14T06:30:00.000Z"), Date.parse("2026-10-14T07:15:00.000Z")]; // 2 calls today (09:30 and 10:15 Nairobi)
const pace = computeAgentPace({ callTimesMs: [...callsLookback, ...todayCalls], nowMs: NOW, schedule: DEFAULT_WORKING_HOURS, clockMode: "working_hours", calls_remaining: 100, sms_remaining: 12 });

assert(pace.working_hours_lookback === 29, `29 working hours in the lookback (got ${pace.working_hours_lookback})`);
assert(pace.calls_lookback === 60, `60 calls in the lookback (got ${pace.calls_lookback})`);
assert(pace.calls_per_hour_average === 2.1, `average rate 60 / 29 = 2.1 (got ${pace.calls_per_hour_average})`);
assert(pace.working_hours_today === 2 && pace.calls_today === 2 && pace.calls_per_hour_today === 1, `today: 2 calls in 2 working hours (got ${pace.calls_today} in ${pace.working_hours_today})`);
assert(pace.hours_to_clear === 47.6, `100 calls / 2.1 per hour = 47.6 hours (got ${pace.hours_to_clear})`);
assert(pace.projected_finish_at !== null, "a finish time is projected");
assert(pace.advice[0].startsWith("At 2.1 calls per hour (your average over the last 5 working days) you will clear your 100 remaining calls in about 48 working hours, finishing "), `headline advice (got: ${pace.advice[0]})`);
assert(pace.advice.some((l) => l.startsWith("Today's rate of 1 call per hour is below your average. At today's rate it would take about 100 working hours.")), `today's rate advice (got: ${pace.advice.join(" | ")})`);
assert(pace.advice.some((l) => l.includes("You also owe 12 SMS")), "SMS owed is reported");
assert(pace.advice.every((l) => !l.includes("\u2014") && !l.includes("\u2013")), "advice contains no dashes used as punctuation");

// exact finish time for a clean case: average exactly 2.0 per hour
const cleanCalls = Array.from({ length: 58 }, (_, i) => lookStart + 10 * 3_600_000 + i * 60_000);
const clean = computeAgentPace({ callTimesMs: cleanCalls, nowMs: NOW, schedule: DEFAULT_WORKING_HOURS, clockMode: "working_hours", calls_remaining: 100, sms_remaining: 0 });
assert(clean.calls_per_hour_average === 2 && clean.hours_to_clear === 50, "58 calls over 29 hours is exactly 2 per hour and 100 calls need 50 hours");
assert(clean.projected_finish_at === "2026-10-22T07:00:00.000Z", `finish is Thu 22 Oct 10:00 Nairobi (got ${clean.projected_finish_at})`);
assert(clean.advice[0].endsWith("finishing Thursday 22/10 around 10:00."), `finish text (got: ${clean.advice[0]})`);

// above and in line with the average
const fast = computeAgentPace({ callTimesMs: [...cleanCalls, ...Array.from({ length: 6 }, (_, i) => NOW - (i + 1) * 60_000)], nowMs: NOW, schedule: DEFAULT_WORKING_HOURS, clockMode: "working_hours", calls_remaining: 10, sms_remaining: 0 });
assert(fast.advice.some((l) => l.includes("is above your average")), "a faster day is described as above average");

// nothing remaining
const none = computeAgentPace({ callTimesMs: [], nowMs: NOW, schedule: DEFAULT_WORKING_HOURS, clockMode: "working_hours", calls_remaining: 0, sms_remaining: 3 });
assert(none.advice[0] === "You have no calls remaining on your open list." && none.hours_to_clear === 0 && none.advice[1].includes("3 SMS"), "no calls remaining");

// no calls recorded at all
const idle = computeAgentPace({ callTimesMs: [], nowMs: NOW, schedule: DEFAULT_WORKING_HOURS, clockMode: "working_hours", calls_remaining: 40, sms_remaining: 0 });
assert(idle.calls_per_hour_average === 0 && idle.hours_to_clear === null && idle.projected_finish_at === null, "no calls means no projection");
assert(idle.advice[0].includes("No outgoing calls were recorded") && idle.advice[0].includes("40 calls remaining"), `idle advice (got: ${idle.advice[0]})`);

// not enough working time on record (10 minute working day: 5 days = 50 minutes)
const tiny: WorkingHoursSchedule = JSON.parse(JSON.stringify(DEFAULT_WORKING_HOURS));
for (const k of Object.keys(tiny) as Array<keyof WorkingHoursSchedule>) { tiny[k].enabled = true; tiny[k].open = "09:00"; tiny[k].close = "09:10"; }
const sparse = computeAgentPace({ callTimesMs: [], nowMs: Date.parse("2026-10-14T06:30:00.000Z"), schedule: tiny, clockMode: "working_hours", calls_remaining: 5, sms_remaining: 0 });
assert(sparse.calls_per_hour_average === null && sparse.advice[0].includes("not enough working time"), `sparse advice (got: ${sparse.advice[0]})`);

// a schedule with no working days must not hang and must say so
const closed = computeAgentPace({ callTimesMs: [NOW - 1000], nowMs: NOW, schedule: noDays, clockMode: "working_hours", calls_remaining: 5, sms_remaining: 0 });
assert(closed.projected_finish_at === null && closed.advice[0].includes("not enough working time"), "no working days gives no projection");

// continuous clock projects in plain hours
const cont = computeAgentPace({ callTimesMs: Array.from({ length: 120 }, (_, i) => NOW - 3_600_000 * (i + 1)), nowMs: NOW, schedule: DEFAULT_WORKING_HOURS, clockMode: "continuous_24_7", calls_remaining: 10, sms_remaining: 0 });
assert(cont.calls_per_hour_average === 1 && cont.hours_to_clear === 10 && cont.projected_finish_at === new Date(NOW + 10 * 3_600_000).toISOString(), "continuous clock: 1 call per hour, 10 calls, 10 hours");

// finish wording
assert(describeFinish(new Date(NOW + 3_600_000), new Date(NOW)) === "today around 12:00", "same day wording");
assert(describeFinish(new Date(NOW + DAY), new Date(NOW)) === "tomorrow around 11:00", "next day wording");

console.log("All agent KPI and pace tests passed!");
// V15 END tests/agentKpi.test.ts

