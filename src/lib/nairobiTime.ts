// FIXPASS src/lib/nairobiTime.ts
// Nairobi has no daylight saving, so the offset is a constant +03:00.
const NAIROBI_TZ = 'Africa/Nairobi';

/** ISO instant -> 'YYYY-MM-DDTHH:mm' in Nairobi time, for <input type="datetime-local">. */
export function toNairobiInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** 'YYYY-MM-DDTHH:mm' entered as Nairobi time -> ISO string with an explicit +03:00 offset. */
export function nairobiInputToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  return `${local}:00+03:00`;
}

/** ISO instant -> "Wed 14 Oct 2026, 10:30 AM" in Nairobi time, for display. Empty string when invalid. */
export function formatNairobiDisplay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NAIROBI_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${g('weekday')} ${g('day')} ${g('month')} ${g('year')}, ${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()}`;
}
// FIXPASS END src/lib/nairobiTime.ts

