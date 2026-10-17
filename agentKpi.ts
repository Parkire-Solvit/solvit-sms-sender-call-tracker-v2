// V15 agentKpi.ts
// Per-agent completeness KPI and pace advisor. Pure functions: no database, no network.
// The same functions serve Insurance Job Callbacks and Pending Submissions.
import { WorkingHoursSchedule } from "./src/types/compliance";
import { NAIROBI_OFFSET_MS, calculateDeadlineTimestamp, calculateElapsedMinutes, getNairobiDate } from "./complianceEngine";
import { parseDbTimestamp } from "./pendingSubmissions";

/** Records that closed longer ago than this no longer count towards an agent's completion rate. */
export const KPI_WINDOW_DAYS = 30;
/** The pace projection uses the average rate over this many working days (including today so far). */
export const PACE_LOOKBACK_WORKING_DAYS = 5;
/** Today's rate is only quoted after this many working minutes have passed today. */
export const MIN_WORKING_MINUTES_FOR_TODAY_RATE = 15;
/** The 5 day rate is only used when at least this many working minutes are on record. */
export const MIN_WORKING_MINUTES_FOR_AVERAGE_RATE = 60;
/** Today's rate is described as below or above the average when it differs by more than this fraction. */
export const RATE_DIFFERENCE_THRESHOLD = 0.2;

const DAY_MS = 86_400_000;
type ClockMode = "working_hours" | "continuous_24_7";

// ---------------------------------------------------------------------------
// Completion KPI
// ---------------------------------------------------------------------------

export interface KpiRecord {
  /** The agent the record is assigned to, or null. */
  agent_id: number | null;
  /** Normalised client phone. All vehicles of one customer share it. */
  customer_key: string;
  status: "AMBER" | "GREEN" | "RED";
  /** True when the record was closed by an upload that no longer contained it (not by the agent). */
  closed_by_upload: boolean;
  closed_at: unknown;
  /** The date the work was due (Pending: schedule date; Callbacks: initiated date). Used only for age. */
  reference_at: unknown;
  /** Counted outgoing calls and SMS for this record (the section's own counting rule). */
  calls: number;
  sms: number;
}

export interface KpiRequirements {
  calls: number;
  sms: number;
}

export interface AgentIdentity {
  id: number;
  name: string;
}

export interface AgentKpi {
  agent_id: number;
  agent_name: string;
  /** Open records plus records the agent completed inside the window. */
  in_scope: number;
  /** Closed inside the window by an agent outcome or by reaching the call and SMS maximums. */
  completed: number;
  open: number;
  /** Closed inside the window because an upload no longer contained them. Not part of in_scope. */
  closed_by_upload: number;
  /** completed / in_scope as a percentage with one decimal, or null when in_scope is 0. */
  completion_rate: number | null;
  /** True when the agent has no open records. */
  all_clear: boolean;
  /** Open records with no counted call and no counted SMS. */
  never_contacted: number;
  /** Open records that have some contact but have not reached both maximums. */
  below_target: number;
  /** Open records that have reached both maximums but are still open (waiting for the grace period). */
  at_target_open: number;
  open_customers: number;
  /** Calls still to make. One call to a customer counts for all of that customer's vehicles. */
  calls_remaining: number;
  sms_remaining: number;
  oldest_open_days: number | null;
}

export interface KpiResult {
  agents: AgentKpi[];
  /** Open records that belong to nobody on the team. */
  unassigned_open: number;
}

export function computeAgentKpis(
  records: KpiRecord[],
  agents: AgentIdentity[],
  req: KpiRequirements,
  nowMs: number,
  windowDays: number = KPI_WINDOW_DAYS
): KpiResult {
  const byAgent = new Map<number, AgentKpi>();
  const customers = new Map<number, Map<string, { calls: number; sms: number }>>();
  const oldest = new Map<number, number>();
  for (const a of agents) {
    byAgent.set(a.id, {
      agent_id: a.id,
      agent_name: a.name,
      in_scope: 0,
      completed: 0,
      open: 0,
      closed_by_upload: 0,
      completion_rate: null,
      all_clear: true,
      never_contacted: 0,
      below_target: 0,
      at_target_open: 0,
      open_customers: 0,
      calls_remaining: 0,
      sms_remaining: 0,
      oldest_open_days: null,
    });
    customers.set(a.id, new Map());
  }

  const windowStart = nowMs - windowDays * DAY_MS;
  let unassignedOpen = 0;

  for (const r of records) {
    const kpi = r.agent_id === null ? undefined : byAgent.get(Number(r.agent_id));
    if (!kpi) {
      if (r.status === "AMBER") unassignedOpen += 1;
      continue;
    }

    if (r.status === "AMBER") {
      kpi.open += 1;
      const callsMet = r.calls >= req.calls;
      const smsMet = r.sms >= req.sms;
      if (r.calls === 0 && r.sms === 0) kpi.never_contacted += 1;
      else if (callsMet && smsMet) kpi.at_target_open += 1;
      else kpi.below_target += 1;

      const perCustomer = customers.get(kpi.agent_id)!;
      const entry = perCustomer.get(r.customer_key) ?? { calls: 0, sms: 0 };
      entry.calls = Math.max(entry.calls, Math.max(0, req.calls - r.calls));
      entry.sms = Math.max(entry.sms, Math.max(0, req.sms - r.sms));
      perCustomer.set(r.customer_key, entry);

      const refMs = parseDbTimestamp(r.reference_at);
      if (!isNaN(refMs) && (!oldest.has(kpi.agent_id) || refMs < oldest.get(kpi.agent_id)!)) oldest.set(kpi.agent_id, refMs);
      continue;
    }

    // Closed record: only those closed inside the window count. A missing or unreadable closed_at is treated as inside.
    const closedMs = parseDbTimestamp(r.closed_at);
    if (!isNaN(closedMs) && closedMs < windowStart) continue;
    if (r.closed_by_upload) kpi.closed_by_upload += 1;
    else kpi.completed += 1;
  }

  for (const kpi of byAgent.values()) {
    kpi.in_scope = kpi.open + kpi.completed;
    kpi.completion_rate = kpi.in_scope === 0 ? null : Math.round((kpi.completed / kpi.in_scope) * 1000) / 10;
    kpi.all_clear = kpi.open === 0;
    const perCustomer = customers.get(kpi.agent_id)!;
    kpi.open_customers = perCustomer.size;
    for (const c of perCustomer.values()) {
      kpi.calls_remaining += c.calls;
      kpi.sms_remaining += c.sms;
    }
    const o = oldest.get(kpi.agent_id);
    kpi.oldest_open_days = o === undefined ? null : Math.max(0, Math.floor((nowMs - o) / DAY_MS));
  }

  return { agents: agents.map((a) => byAgent.get(a.id)!), unassigned_open: unassignedOpen };
}

// ---------------------------------------------------------------------------
// Pace advisor
// ---------------------------------------------------------------------------

export interface PaceInput {
  /** Timestamps (ms) of the agent's counted outgoing calls. */
  callTimesMs: number[];
  nowMs: number;
  schedule: WorkingHoursSchedule;
  clockMode: ClockMode;
  calls_remaining: number;
  sms_remaining: number;
}

export interface AgentPace {
  calls_today: number;
  working_hours_today: number;
  calls_per_hour_today: number | null;
  calls_lookback: number;
  working_hours_lookback: number;
  calls_per_hour_average: number | null;
  /** Working hours needed to make the remaining calls at the average rate, or null when it cannot be projected. */
  hours_to_clear: number | null;
  /** ISO time the remaining calls would be finished, or null. */
  projected_finish_at: string | null;
  advice: string[];
}

const NAIROBI_MIDNIGHT = (ms: number): number => Math.floor((ms + NAIROBI_OFFSET_MS) / DAY_MS) * DAY_MS - NAIROBI_OFFSET_MS;

function hasWorkingDays(schedule: WorkingHoursSchedule): boolean {
  return Object.values(schedule).some((d) => d && d.enabled);
}

/** Start of the lookback window: Nairobi midnight of the 5th working day back (today counts), or 5 x 24 hours when the clock is continuous. */
export function lookbackStartMs(nowMs: number, schedule: WorkingHoursSchedule, clockMode: ClockMode, days: number = PACE_LOOKBACK_WORKING_DAYS): number | null {
  if (clockMode === "continuous_24_7") return nowMs - days * DAY_MS;
  if (!hasWorkingDays(schedule)) return null;
  const today = NAIROBI_MIDNIGHT(nowMs);
  let counted = 0;
  for (let back = 0; back <= 60; back++) {
    const dayStart = today - back * DAY_MS;
    const info = getNairobiDate(new Date(dayStart + 12 * 3_600_000));
    if (schedule[info.dayName]?.enabled) {
      counted += 1;
      if (counted === days) return dayStart;
    }
  }
  return today - 60 * DAY_MS;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function fmtRate(n: number): string {
  return n < 10 ? String(round1(n)) : String(Math.round(n));
}

function perHour(n: number): string {
  return n === 1 ? "1 call per hour" : `${fmtRate(n)} calls per hour`;
}

function fmtHours(h: number): string {
  if (h < 1) return "less than 1 working hour";
  const v = h < 10 ? round1(h) : Math.round(h);
  return `about ${v} working ${v === 1 ? "hour" : "hours"}`;
}

const NAIROBI_PARTS = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);

/** "today around 15:40", "tomorrow around 09:15" or "Tuesday around 11:20", in Nairobi time, rounded up to 5 minutes. */
export function describeFinish(finish: Date, now: Date): string {
  const rounded = new Date(Math.ceil(finish.getTime() / 300_000) * 300_000);
  const part = (parts: Intl.DateTimeFormatPart[], t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const f = NAIROBI_PARTS(rounded);
  const n = NAIROBI_PARTS(now);
  const dateKey = (parts: Intl.DateTimeFormatPart[]) => `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
  const tomorrow = NAIROBI_PARTS(new Date(now.getTime() + DAY_MS));
  const time = `${part(f, "hour")}:${part(f, "minute")}`;
  if (dateKey(f) === dateKey(n)) return `today around ${time}`;
  if (dateKey(f) === dateKey(tomorrow)) return `tomorrow around ${time}`;
  return `${part(f, "weekday")} ${part(f, "day")}/${part(f, "month")} around ${time}`;
}

export function computeAgentPace(input: PaceInput): AgentPace {
  const { nowMs, schedule, clockMode } = input;
  const now = new Date(nowMs);
  const calls = input.callTimesMs.filter((t) => Number.isFinite(t) && t <= nowMs);

  const pace: AgentPace = {
    calls_today: 0,
    working_hours_today: 0,
    calls_per_hour_today: null,
    calls_lookback: 0,
    working_hours_lookback: 0,
    calls_per_hour_average: null,
    hours_to_clear: null,
    projected_finish_at: null,
    advice: [],
  };

  const workable = clockMode === "continuous_24_7" || hasWorkingDays(schedule);
  const todayStart = NAIROBI_MIDNIGHT(nowMs);
  const lookStart = workable ? lookbackStartMs(nowMs, schedule, clockMode) : null;

  if (workable) {
    const minsToday = calculateElapsedMinutes(new Date(todayStart), now, schedule, clockMode);
    pace.working_hours_today = round1(minsToday / 60);
    pace.calls_today = calls.filter((t) => t >= todayStart).length;
    if (minsToday >= MIN_WORKING_MINUTES_FOR_TODAY_RATE) pace.calls_per_hour_today = round1(pace.calls_today / (minsToday / 60));

    if (lookStart !== null) {
      const minsLook = calculateElapsedMinutes(new Date(lookStart), now, schedule, clockMode);
      pace.working_hours_lookback = round1(minsLook / 60);
      pace.calls_lookback = calls.filter((t) => t >= lookStart).length;
      if (minsLook >= MIN_WORKING_MINUTES_FOR_AVERAGE_RATE) pace.calls_per_hour_average = round1(pace.calls_lookback / (minsLook / 60));
    }
  }

  const remaining = Math.max(0, Math.round(input.calls_remaining));
  const smsRemaining = Math.max(0, Math.round(input.sms_remaining));
  const smsLine = smsRemaining > 0 ? `You also owe ${smsRemaining} SMS. These are not included in the time estimate.` : "";
  const avg = pace.calls_per_hour_average;

  if (remaining === 0) {
    pace.hours_to_clear = 0;
    pace.advice.push("You have no calls remaining on your open list.");
    if (smsLine) pace.advice.push(smsLine);
    return pace;
  }

  if (avg === null) {
    pace.advice.push(`You have ${remaining} calls remaining. There is not enough working time on record yet to measure your calling rate.`);
    if (smsLine) pace.advice.push(smsLine);
    return pace;
  }

  if (avg <= 0) {
    pace.advice.push(`No outgoing calls were recorded in your last ${PACE_LOOKBACK_WORKING_DAYS} working days, so a clearing time cannot be projected. You have ${remaining} calls remaining.`);
    if (smsLine) pace.advice.push(smsLine);
    return pace;
  }

  const hours = remaining / avg;
  pace.hours_to_clear = round1(hours);
  let finish: Date | null = null;
  if (clockMode === "continuous_24_7" || hasWorkingDays(schedule)) {
    finish = calculateDeadlineTimestamp(now, hours * 60, schedule, clockMode);
    if (!Number.isFinite(finish.getTime())) finish = null;
  }
  if (finish) pace.projected_finish_at = finish.toISOString();

  const callsWord = remaining === 1 ? "call" : "calls";
  const finishText = finish ? `, finishing ${describeFinish(finish, now)}` : "";
  pace.advice.push(
    `At ${perHour(avg)} (your average over the last ${PACE_LOOKBACK_WORKING_DAYS} working days) you will clear your ${remaining} remaining ${callsWord} in ${fmtHours(hours)}${finishText}.`
  );

  const today = pace.calls_per_hour_today;
  if (today !== null) {
    if (today < avg * (1 - RATE_DIFFERENCE_THRESHOLD)) {
      const slow = today > 0 ? ` At today's rate it would take ${fmtHours(remaining / today)}.` : " At that rate no calls would be cleared.";
      pace.advice.push(`Today's rate of ${perHour(today)} is below your average.${slow}`);
    } else if (today > avg * (1 + RATE_DIFFERENCE_THRESHOLD)) {
      pace.advice.push(`Today's rate of ${perHour(today)} is above your average. If you keep it up you will finish sooner.`);
    } else {
      pace.advice.push(`Today's rate of ${perHour(today)} is in line with your average.`);
    }
  }
  pace.advice.push("The estimate assumes no record closes early. Closing a record sooner shortens it, and new uploads add to it.");
  if (smsLine) pace.advice.push(smsLine);
  return pace;
}
// V15 END agentKpi.ts

