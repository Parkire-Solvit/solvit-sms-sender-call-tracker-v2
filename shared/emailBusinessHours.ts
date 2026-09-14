// Email SLA calendar: Monday-Friday, 08:00-17:00 Africa/Nairobi (UTC+03:00).
// Nairobi has no daylight-saving transition; dates are stored as UTC instants.
const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const nairobiOffsetMs = 3 * hourMs;
const openOffsetMs = 8 * hourMs;
const closeOffsetMs = 17 * hourMs;

function localDayStartUtc(date: Date): number {
  const local = new Date(date.getTime() + nairobiOffsetMs);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - nairobiOffsetMs;
}

function localDate(dayStartUtc: number): string {
  return new Date(dayStartUtc + nairobiOffsetMs).toISOString().slice(0, 10);
}

function workingDay(dayStartUtc: number, holidays: readonly string[]): boolean {
  const weekday = new Date(dayStartUtc + nairobiOffsetMs).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !holidays.includes(localDate(dayStartUtc));
}

export function isEmailWorkingTime(date: Date, holidays: readonly string[]): boolean {
  const day = localDayStartUtc(date);
  return workingDay(day, holidays) && date.getTime() >= day + openOffsetMs && date.getTime() < day + closeOffsetMs;
}

export function nextEmailWorkingStart(date: Date, holidays: readonly string[]): Date {
  let day = localDayStartUtc(date);
  for (let i = 0; i < 3660; i++, day += dayMs) {
    if (!workingDay(day, holidays)) continue;
    const open = day + openOffsetMs;
    const close = day + closeOffsetMs;
    if (date.getTime() < open) return new Date(open);
    if (date.getTime() < close) return new Date(date);
  }
  throw new Error('No Email SLA working day found within ten years');
}

export function addEmailWorkingMinutes(start: Date, minutes: number, holidays: readonly string[]): Date {
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(minutes) || minutes < 0) {
    throw new Error('Invalid Email SLA start or duration');
  }
  let cursor = nextEmailWorkingStart(start, holidays).getTime();
  let remaining = minutes * minuteMs;
  if (remaining === 0) return new Date(cursor);
  for (let i = 0; i < 3660; i++) {
    const close = localDayStartUtc(new Date(cursor)) + closeOffsetMs;
    const available = close - cursor;
    if (remaining <= available) return new Date(cursor + remaining);
    remaining -= available;
    cursor = nextEmailWorkingStart(new Date(close), holidays).getTime();
  }
  throw new Error('Email SLA duration exceeds ten years of working hours');
}

export function emailWorkingMinutesBetween(start: Date, end: Date, holidays: readonly string[]): number {
  if (end <= start) return 0;
  let day = localDayStartUtc(start);
  let elapsed = 0;
  for (let i = 0; day < end.getTime() && i < 3660; i++, day += dayMs) {
    if (!workingDay(day, holidays)) continue;
    const from = Math.max(start.getTime(), day + openOffsetMs);
    const until = Math.min(end.getTime(), day + closeOffsetMs);
    if (until > from) elapsed += until - from;
  }
  return elapsed / minuteMs;
}

export function validEmailHolidayDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
