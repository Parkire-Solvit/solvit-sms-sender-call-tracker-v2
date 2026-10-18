// V18 tests/outcomeReceiptsDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping outcome receipt DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipts-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const rc = await import(path.join(root, "outcomeReceipts.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for save receipts...");

  const id = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  assert((await rc.claimOutcomeReceipt(db, "pending-submissions", id, 7)) === "new", "first claim is new");
  assert((await rc.claimOutcomeReceipt(db, "pending-submissions", id, 7)) === "duplicate", "second claim is a duplicate");
  assert((await rc.claimOutcomeReceipt(db, "callbacks", id, 9)) === "duplicate", "the same id in the other section is still a duplicate");
  const count = async () => Number((await db.queryOne("SELECT COUNT(*) AS n FROM outcome_receipts")).n);
  assert((await count()) === 1, "only one receipt row exists");

  // A failed save releases its receipt so the retry really saves.
  await rc.releaseOutcomeReceipt(db, id);
  assert((await count()) === 0, "release removes the receipt");
  assert((await rc.claimOutcomeReceipt(db, "pending-submissions", id, 7)) === "new", "after a release the id can be claimed again");

  // No protection without a valid id, and nothing is written.
  for (const bad of [undefined, null, "", "short", "has spaces in it which is not allowed....", "x".repeat(65), 12345]) {
    assert((await rc.claimOutcomeReceipt(db, "callbacks", bad, 1)) === "none", `invalid id ${JSON.stringify(bad)} gives none`);
  }
  assert((await count()) === 1, "invalid ids wrote nothing");
  await rc.releaseOutcomeReceipt(db, "nope"); // must not throw
  await rc.releaseOutcomeReceipt(db, undefined); // must not throw

  // Concurrent claims of one id: exactly one is new.
  const results = await Promise.all(Array.from({ length: 8 }, () => rc.claimOutcomeReceipt(db, "callbacks", "ffffffffffffffffffffffffffffffff", 3)));
  assert(results.filter((r: string) => r === "new").length === 1, "exactly one concurrent claim wins");
  assert(results.filter((r: string) => r === "duplicate").length === 7, "the others are duplicates");

  console.log("All save receipt DB tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
// V18 END tests/outcomeReceiptsDb.test.ts

