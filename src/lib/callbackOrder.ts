// Ordering for Callbacks: the oldest outstanding work comes first. Pure: no React, no DOM, no database.
// Shared by the server list, the callbacks list screen and the call session queue so that all three agree.

export const UNASSIGNED_PARTNER_LABEL = 'Unassigned Partner';

/**
 * Milliseconds for a callback date, or Infinity when it is missing or unreadable (so undated work sorts last).
 * "01/10/2026", "01-10-2026" and "01.10.2026" are read day first (1 October), the same as the agent KPI, before
 * anything the JavaScript engine would read month first. ISO dates and timestamps are read as given.
 */
export function parseCallbackDateMs(value: unknown): number {
  if (value === null || value === undefined) return Infinity;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? Infinity : t;
  }
  const s = String(value).trim();
  if (s === '') return Infinity;
  const dayFirst = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dayFirst) {
    const ms = Date.UTC(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]));
    if (!Number.isNaN(ms)) return ms;
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? Infinity : parsed;
}

export interface CallbackOrderable {
  id: number;
  channel_partner: string | null;
  client_phone: string;
  initiated_date: string | null;
  created_at?: unknown;
}

/** When the work was due: the initiated date, falling back to the date the record was created. */
export function callbackReferenceMs(job: Pick<CallbackOrderable, 'initiated_date' | 'created_at'>): number {
  const initiated = parseCallbackDateMs(job.initiated_date);
  return initiated !== Infinity ? initiated : parseCallbackDateMs(job.created_at);
}

const cmp = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

/** Oldest first. Undated records last. Ties by id. */
export function compareCallbacksOldestFirst(a: CallbackOrderable, b: CallbackOrderable): number {
  return cmp(callbackReferenceMs(a), callbackReferenceMs(b)) || cmp(a.id, b.id);
}

/**
 * Orders callbacks so the job that needs attention first is at the top while the partner and customer structure is kept:
 * 1. channel partners, by the partner's oldest job (ties: partner name),
 * 2. inside a partner, customers (client phone), by the customer's oldest job (ties: phone),
 * 3. inside a customer, vehicles oldest first.
 * The input is not changed.
 */
export function sortCallbacksOldestFirst<T extends CallbackOrderable>(jobs: T[]): T[] {
  const partnerOf = (j: T) => j.channel_partner || UNASSIGNED_PARTNER_LABEL;
  const partnerOldest = new Map<string, number>();
  const customerOldest = new Map<string, number>();
  const customerKey = (j: T) => `${partnerOf(j)}\u0000${j.client_phone}`;
  for (const j of jobs) {
    const ms = callbackReferenceMs(j);
    const p = partnerOf(j);
    if (!partnerOldest.has(p) || ms < partnerOldest.get(p)!) partnerOldest.set(p, ms);
    const c = customerKey(j);
    if (!customerOldest.has(c) || ms < customerOldest.get(c)!) customerOldest.set(c, ms);
  }
  return [...jobs].sort(
    (a, b) =>
      cmp(partnerOldest.get(partnerOf(a))!, partnerOldest.get(partnerOf(b))!) ||
      partnerOf(a).localeCompare(partnerOf(b)) ||
      cmp(customerOldest.get(customerKey(a))!, customerOldest.get(customerKey(b))!) ||
      a.client_phone.localeCompare(b.client_phone) ||
      compareCallbacksOldestFirst(a, b)
  );
}
