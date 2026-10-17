// V15 src/lib/submissionQueue.ts
// Ordering and customer grouping for Pending Submissions. Pure: no React, no DOM, no database.

export interface QueueRecord {
  external_id: number;
  client_phone: string;
  schedule_date: string | null;
}

/** Milliseconds for a schedule date, or Infinity when it is missing or unreadable (so undated records sort last). */
export function scheduleMs(value: string | null | undefined): number {
  if (value === null || value === undefined) return Infinity;
  const s = String(value).trim();
  if (s === '') return Infinity;
  // A timestamp with no timezone (for example "2026-10-01 08:30:00") is read as UTC, the same as the server does.
  const normalised = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? Infinity : ms;
}

/** Oldest schedule date first (longest overdue first). Undated records last. Ties by external_id ascending. */
export function compareOldestFirst(a: QueueRecord, b: QueueRecord): number {
  const am = scheduleMs(a.schedule_date);
  const bm = scheduleMs(b.schedule_date);
  if (am !== bm) return am < bm ? -1 : 1;
  return a.external_id - b.external_id;
}

export interface CustomerGroup<T extends QueueRecord> {
  client_phone: string;
  /** Schedule date of the customer's oldest vehicle (Infinity when none of them has a date). */
  oldest_schedule_ms: number;
  /** All of the customer's vehicles, oldest first. */
  records: T[];
}

/**
 * One group per customer (normalised client phone). Vehicles inside a group are oldest first. Groups are ordered by
 * the customer's OLDEST vehicle, oldest first, so the longest overdue work is always at the top whatever the company.
 * Ties: the lowest external_id in the group, then the phone.
 */
export function groupByCustomerOldestFirst<T extends QueueRecord>(records: T[]): CustomerGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const r of records) {
    const list = map.get(r.client_phone);
    if (list) list.push(r);
    else map.set(r.client_phone, [r]);
  }
  const groups: CustomerGroup<T>[] = [];
  for (const [client_phone, list] of map) {
    const sorted = [...list].sort(compareOldestFirst);
    groups.push({ client_phone, oldest_schedule_ms: scheduleMs(sorted[0].schedule_date), records: sorted });
  }
  groups.sort((a, b) => {
    if (a.oldest_schedule_ms !== b.oldest_schedule_ms) return a.oldest_schedule_ms < b.oldest_schedule_ms ? -1 : 1;
    const idDiff = a.records[0].external_id - b.records[0].external_id;
    if (idDiff !== 0) return idDiff;
    return a.client_phone.localeCompare(b.client_phone);
  });
  return groups;
}
// V15 END src/lib/submissionQueue.ts

