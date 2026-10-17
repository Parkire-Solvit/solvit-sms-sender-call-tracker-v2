// FIXPASS rateLimit.ts
// Minimal in-memory sliding-window rate limiter. Per process: with several instances the limit is per instance.

export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
}

export function createRateLimiter(opts: { windowMs: number; max: number; now?: () => number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const now = opts.now ?? Date.now;
  return {
    check(key: string) {
      const t = now();
      const cutoff = t - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((h) => h > cutoff);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + opts.windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      // Drop idle keys so the map cannot grow without bound.
      if (hits.size > 1000) {
        for (const [k, v] of hits) if (v.every((h) => h <= cutoff)) hits.delete(k);
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
// FIXPASS END rateLimit.ts

