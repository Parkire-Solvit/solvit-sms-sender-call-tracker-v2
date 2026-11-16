// Lightweight warnings that show in the host's logs when the server is slow, so a stall is visible before agents
// report it. Nothing is stored; nothing personal is logged (paths only, no query strings or bodies).
import type { Request, Response, NextFunction } from "express";

export const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS || 2000);
export const BUSY_LAG_MS = Number(process.env.BUSY_LAG_MS || 1000);

/** Logs any API request that takes longer than SLOW_REQUEST_MS. */
export function logSlowRequests(request: Request, response: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  const where = `${request.method} ${(request.originalUrl || request.url).split("?")[0]}`; // the path only, never the query
  response.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms >= SLOW_REQUEST_MS) console.warn(`[SLOW] ${where} ${response.statusCode} ${Math.round(ms)} ms`);
  });
  next();
}

/**
 * Warns when the server could not respond to anything for a while (a long calculation blocking every request,
 * which is what stalled outcome saves). Checks once a second; the timer never keeps the process alive.
 */
export function startBusyMonitor(): void {
  let expected = Date.now() + 1000;
  setInterval(() => {
    const lag = Date.now() - expected;
    if (lag >= BUSY_LAG_MS) console.warn(`[SLOW] Server busy: every request was held up for about ${Math.round(lag)} ms`);
    expected = Date.now() + 1000;
  }, 1000).unref();
}
