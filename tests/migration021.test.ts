// V15 tests/migration021.test.ts
import fs from "node:fs";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for pending submissions SMS-rule migration...");

const root = process.cwd(); // tests are always run from the repository root via npm test
const sqlFile = fs.readFileSync(path.join(root, "migrations", "030_pending_submissions_sms_rule.sql"), "utf8");

assert(sqlFile.replace(/\s+/g, " ").trim().length > 100, "the .sql file is not empty");
assert(sqlFile.includes("max_sms_attempts"), "migration adds max_sms_attempts");
assert(sqlFile.includes("ADD COLUMN IF NOT EXISTS"), "migration is safe to run twice");

console.log("All pending submissions SMS-rule migration tests passed!");
// V15 END tests/migration021.test.ts

