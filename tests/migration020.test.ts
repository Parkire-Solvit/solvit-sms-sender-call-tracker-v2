// FIXPASS tests/migration020.test.ts
import fs from "node:fs";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for pending submissions fix migration...");

const root = process.cwd(); // tests are always run from the repository root via npm test
const sqlFile = fs.readFileSync(path.join(root, "migrations", "029_pending_submissions_fix_pass.sql"), "utf8");

assert(sqlFile.replace(/\s+/g, " ").trim().length > 500, "the .sql file is not empty");

for (const needle of [
  "solver_notification_error",
  "solver_sms_template",
  "max_attempts_grace_minutes",
  "CREATE TABLE IF NOT EXISTS integration_settings",
  "REOPENED_BY_SYSTEM",
]) {
  assert(sqlFile.includes(needle), `migration contains ${needle}`);
}

console.log("All pending submissions fix migration tests passed!");
// FIXPASS END tests/migration020.test.ts

