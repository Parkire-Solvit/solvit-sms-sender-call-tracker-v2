// V16 tests/migration022.test.ts
import fs from "node:fs";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for pending submissions team-signature migration...");

const root = process.cwd(); // tests are always run from the repository root via npm test
const sqlFile = fs.readFileSync(path.join(root, "migrations", "031_pending_submissions_team_signature.sql"), "utf8");

assert(sqlFile.replace(/\s+/g, " ").trim().length > 50, "the .sql file is not empty");
assert(sqlFile.includes("team_signature"), "migration adds team_signature");
assert(sqlFile.includes("ADD COLUMN IF NOT EXISTS"), "migration is safe to run twice");

console.log("All pending submissions team-signature migration tests passed!");
// V16 END tests/migration022.test.ts

