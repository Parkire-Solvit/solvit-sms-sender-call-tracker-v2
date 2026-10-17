// FIXPASS httpError.ts
import type { Response } from "express";

/** Thrown by business logic to produce a specific HTTP status. Message is safe to show to users. */
export class HttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}

/** Single place that turns an error into an HTTP response. Never leaks internals on 500. */
export function sendError(res: Response, err: unknown, tag: string): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.extra ?? {}) });
    return;
  }
  console.error(`[API] ${tag}:`, err);
  res.status(500).json({ error: "Internal server error" });
}
// FIXPASS END httpError.ts

