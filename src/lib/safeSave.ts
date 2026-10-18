// V18 src/lib/safeSave.ts
// Safe saving of agent outcomes.
// - An outcome is written to this browser BEFORE it is sent (write-ahead), and removed only after the server confirms it.
// - Any failure that may be temporary (no internet, signed out, proxy page, server error) keeps the outcome on this device
//   and it is sent again automatically. The caller is told it was NOT saved, so the screen never shows a false "saved".
// - Every send carries a client_request_id, so a retry that already reached the server is recognised and not saved twice.

export interface SaveResult {
  ok: boolean;
  status: number;
  data: any;
  error: string | null;
  queued: boolean;
  auth: boolean;
  duplicate: boolean;
}

export interface QueueEntry {
  id: string;
  key: string;
  url: string;
  body: Record<string, unknown>;
  label: string;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  auth: boolean;
}

export interface SaveState {
  pending: QueueEntry[];
  authProblem: boolean;
  sessionProblem: boolean;
  flushing: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Deps {
  fetchFn: (url: string, init?: any) => Promise<any>;
  storage: StorageLike | null;
  now: () => number;
  newId: () => string;
  timeoutMs: number;
}

const QUEUE_KEY = 'solvit_unsaved_outcomes_v1';
const CONFIRMED_KEY = 'solvit_confirmed_by_flush_v1';
const CONFIRMED_AFTER_FLUSH_MS = 15 * 60 * 1000; // a saved copy sent in the background while the screen still shows the form
const CONFIRMED_AFTER_DIRECT_MS = 2 * 60 * 1000; // a batch retried after part of it already saved
const AUTH_TEXT = /authentication required/i;

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (_) {}
  return null;
}

function randomId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
    if (c && typeof c.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (_) {}
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 32).padEnd(32, '0');
}

let deps: Deps = {
  fetchFn: (url, init) => fetch(url, init),
  storage: defaultStorage(),
  now: () => Date.now(),
  newId: randomId,
  timeoutMs: 30000,
};

let queue: QueueEntry[] = [];
let confirmed: Array<{ key: string; id: string; at: number; ttl: number }> = [];
let authProblem = false;
let sessionProblem = false;
let flushing = false;
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: SaveState = { pending: [], authProblem: false, sessionProblem: false, flushing: false };

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(',')}}`;
}

function keyFor(url: string, body: Record<string, unknown>): string {
  const rest: Record<string, unknown> = { ...body };
  delete rest.client_request_id;
  return `${url}|${stable(rest)}`;
}

function persist() {
  try {
    if (deps.storage) {
      if (queue.length === 0) deps.storage.removeItem(QUEUE_KEY);
      else deps.storage.setItem(QUEUE_KEY, JSON.stringify(queue));
      const fresh = confirmed.filter((c) => deps.now() - c.at < c.ttl);
      confirmed = fresh;
      if (fresh.length === 0) deps.storage.removeItem(CONFIRMED_KEY);
      else deps.storage.setItem(CONFIRMED_KEY, JSON.stringify(fresh));
    }
  } catch (_) {
    // Storage can be full or blocked. The in-memory queue still works for this page.
  }
}

function notify() {
  snapshot = { pending: queue.map((e) => ({ ...e })), authProblem, sessionProblem, flushing };
  for (const l of listeners) {
    try {
      l();
    } catch (_) {}
  }
}

export function reloadFromStorage(): void {
  queue = [];
  confirmed = [];
  try {
    if (deps.storage) {
      const q = deps.storage.getItem(QUEUE_KEY);
      if (q) {
        const parsed = JSON.parse(q);
        if (Array.isArray(parsed)) queue = parsed.filter((e) => e && typeof e.id === 'string' && typeof e.url === 'string' && e.body && typeof e.body === 'object');
      }
      const c = deps.storage.getItem(CONFIRMED_KEY);
      if (c) {
        const parsed = JSON.parse(c);
        if (Array.isArray(parsed)) confirmed = parsed.filter((e) => e && typeof e.id === 'string' && typeof e.key === 'string' && typeof e.ttl === 'number');
      }
    }
  } catch (_) {
    queue = [];
    confirmed = [];
  }
  authProblem = queue.some((e) => e.auth);
  notify();
}

export function configureSafeSave(overrides: Partial<Deps>): void {
  deps = { ...deps, ...overrides };
  queue = [];
  confirmed = [];
  authProblem = false;
  sessionProblem = false;
  flushing = false;
  inflight.clear();
  reloadFromStorage();
}

export function getSaveState(): SaveState {
  return snapshot;
}

export function subscribeSaveState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

interface Outcome {
  kind: 'ok' | 'retry' | 'permanent';
  status: number;
  data: any;
  message: string;
  auth: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

const AUTH_MESSAGE = 'Your session has expired. Your outcome is safe on this device and will be sent automatically after you sign in again.';

async function sendOnce(entry: QueueEntry): Promise<Outcome> {
  let res: any;
  try {
    res = await withTimeout(
      deps.fetchFn(entry.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...entry.body, client_request_id: entry.id }),
      }),
      deps.timeoutMs
    );
  } catch (_) {
    return { kind: 'retry', status: 0, data: null, message: 'The server could not be reached. Check your internet connection.', auth: false };
  }
  let text = '';
  try {
    text = await res.text();
  } catch (_) {}
  let data: any = null;
  let isJson = true;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    isJson = false;
  }
  const status: number = Number(res.status) || 0;
  const authLike = status === 401 || status === 403 || status === 407 || AUTH_TEXT.test(text);
  if (authLike) return { kind: 'retry', status, data, message: AUTH_MESSAGE, auth: true };
  if (res.ok && isJson && data !== null && typeof data === 'object') return { kind: 'ok', status, data, message: '', auth: false };
  if (res.ok) return { kind: 'retry', status, data, message: AUTH_MESSAGE, auth: true }; // a page that is not our API answered
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { kind: 'retry', status, data, message: `The server had a problem (${status}).`, auth: false };
  }
  const detail = data && typeof data.error === 'string' ? data.error : `Request failed (${status}).`;
  return { kind: 'permanent', status, data, message: detail, auth: false };
}

function removeEntry(id: string) {
  queue = queue.filter((e) => e.id !== id);
}

async function runEntry(entry: QueueEntry, viaFlush: boolean): Promise<SaveResult> {
  inflight.add(entry.id);
  try {
    const out = await sendOnce(entry);
    if (out.kind === 'ok') {
      removeEntry(entry.id);
      confirmed.push({ key: entry.key, id: entry.id, at: deps.now(), ttl: viaFlush ? CONFIRMED_AFTER_FLUSH_MS : CONFIRMED_AFTER_DIRECT_MS });
      authProblem = queue.some((e) => e.auth);
      persist();
      notify();
      return { ok: true, status: out.status, data: out.data, error: null, queued: false, auth: false, duplicate: !!out.data?.duplicate };
    }
    if (out.kind === 'permanent') {
      removeEntry(entry.id);
      authProblem = queue.some((e) => e.auth);
      persist();
      notify();
      return { ok: false, status: out.status, data: out.data, error: out.message, queued: false, auth: false, duplicate: false };
    }
    const stored = queue.find((e) => e.id === entry.id);
    if (stored) {
      stored.attempts += 1;
      stored.lastError = out.message;
      stored.auth = out.auth;
    }
    authProblem = queue.some((e) => e.auth);
    persist();
    notify();
    const suffix = out.auth ? '' : ' It is kept on this device and will be sent automatically.';
    return { ok: false, status: out.status, data: out.data, error: `Not saved yet. ${out.message}${suffix}`, queued: true, auth: out.auth, duplicate: false };
  } finally {
    inflight.delete(entry.id);
  }
}

/** Saves one outcome. Never throws. When ok is false the caller must keep the form on screen and show result.error. */
export async function saveOutcome(url: string, body: Record<string, unknown>, label: string): Promise<SaveResult> {
  const key = keyFor(url, body);
  let entry = queue.find((e) => e.key === key);
  if (!entry) {
    const hit = confirmed.find((c) => c.key === key && deps.now() - c.at < c.ttl);
    if (hit) confirmed = confirmed.filter((c) => c !== hit);
    entry = {
      id: hit ? hit.id : deps.newId(),
      key,
      url,
      body: { ...body },
      label,
      createdAt: deps.now(),
      attempts: 0,
      lastError: null,
      auth: false,
    };
    queue.push(entry);
    persist();
    notify();
  }
  return runEntry(entry, false);
}

/** Sends every saved outcome that is not already being sent. Stops at the first temporary failure. */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  notify();
  try {
    for (const entry of [...queue]) {
      if (inflight.has(entry.id)) continue;
      const result = await runEntry(entry, true);
      if (!result.ok && result.queued) break;
    }
  } finally {
    flushing = false;
    notify();
  }
}

export async function pingSession(): Promise<boolean> {
  let res: any;
  try {
    res = await withTimeout(deps.fetchFn('/api/session-ping', { cache: 'no-store', credentials: 'same-origin' }), 15000);
  } catch (_) {
    return false; // offline is not a sign-in problem, so the flag is left unchanged
  }
  let text = '';
  try {
    text = await res.text();
  } catch (_) {}
  let ok = false;
  try {
    ok = res.ok && JSON.parse(text)?.ok === true;
  } catch (_) {
    ok = false;
  }
  const authLike = !ok && (res.status === 401 || res.status === 403 || res.status === 407 || AUTH_TEXT.test(text) || res.ok);
  if (ok) sessionProblem = false;
  else if (authLike) sessionProblem = true;
  notify();
  return ok;
}

export function describeQueue(): string {
  return queue
    .map((e, i) => `${i + 1}. ${e.label} | ${JSON.stringify(e.body)} | saved on this device at ${new Date(e.createdAt).toISOString()}`)
    .join('\n');
}

let guardStarted = false;

/** Keeps the session warm, warns agents early when they are signed out, and sends saved outcomes when possible. */
export function startSessionGuard(intervalMs: number = 4 * 60 * 1000): void {
  if (guardStarted || typeof window === 'undefined') return;
  guardStarted = true;
  reloadFromStorage();
  const tick = async () => {
    const ok = await pingSession();
    if (ok || queue.length > 0) await flushQueue();
  };
  tick();
  window.setInterval(tick, intervalMs);
  window.setInterval(() => {
    if (queue.length > 0) flushQueue();
  }, 20000);
  window.addEventListener('online', tick);
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  window.addEventListener('beforeunload', (e) => {
    if (queue.length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
// V18 END src/lib/safeSave.ts

