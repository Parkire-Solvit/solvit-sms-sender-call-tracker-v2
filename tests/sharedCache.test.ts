// tests/sharedCache.test.ts
// The shared refresh cache: one calculation per window however many screens ask, cleared by any change.
import { createSharedCache } from "../server/sharedCache";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  console.log("Running tests for sharedCache...");
  let clock = 0;
  const cache = createSharedCache(10_000, () => clock);
  let runs = 0;
  const slow = () => new Promise<number>((resolve) => setTimeout(() => resolve(++runs), 20));

  // Ten screens refreshing at the same moment share one calculation.
  const results = await Promise.all(Array.from({ length: 10 }, () => cache.get("kpi", slow)));
  assert(runs === 1 && results.every((r) => r === 1), `ten simultaneous requests ran the calculation once (ran ${runs})`);

  clock += 9_000;
  assert((await cache.get("kpi", slow)) === 1 && runs === 1, "within the window the shared result is reused");
  clock += 2_000;
  assert((await cache.get("kpi", slow)) === 2 && runs === 2, "after the window it is calculated again");

  assert((await cache.get("other", slow)) === 3, "different keys are cached separately");
  cache.clear();
  assert(cache.size() === 0, "clear empties the cache");
  assert((await cache.get("kpi", slow)) === 4, "after a change the next request recalculates");

  // A failure is not cached.
  let attempt = 0;
  const flaky = async () => { attempt += 1; if (attempt === 1) throw new Error("db down"); return "ok"; };
  let failed = false;
  try { await cache.get("flaky", flaky); } catch { failed = true; }
  assert(failed, "the failure reaches the caller");
  assert((await cache.get("flaky", flaky)) === "ok" && attempt === 2, "the next request tries again instead of reusing the failure");

  // A calculation that finishes after a clear does not bring old data back for later requests... it is replaced.
  let release: (v: string) => void = () => undefined;
  const pending = cache.get("race", () => new Promise<string>((r) => { release = r; }));
  cache.clear();
  const fresh = cache.get("race", async () => "new");
  release("old");
  assert((await pending) === "old" && (await fresh) === "new", "a request after a change gets a new calculation, not the one started before it");
  assert((await cache.get("race", async () => "newer")) === "new", "and that new result is the one shared afterwards");

  console.log("All sharedCache tests passed!");
}

main().catch((err) => { console.error(err); process.exit(1); });
