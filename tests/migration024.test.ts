// V18 tests/migration024.test.ts
import fs from "node:fs";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for the outcome-receipts migration...");

const root = process.cwd(); // tests are always run from the repository root via npm test
const sqlFile = fs.readFileSync(path.join(root, "migrations", "033_outcome_receipts.sql"), "utf8");

assert(sqlFile.replace(/\s+/g, " ").trim().length > 100, "the .sql file is not empty");
assert(sqlFile.includes("CREATE TABLE IF NOT EXISTS outcome_receipts"), "creates the receipts table safely");
assert(/request_id VARCHAR\(64\) NOT NULL UNIQUE/.test(sqlFile), "request_id is unique");
assert(/id BIGSERIAL PRIMARY KEY/.test(sqlFile), "the table has an id so the adapter can read inserted ids");
assert(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(sqlFile), "the migration never removes data");

console.log("All outcome-receipts migration tests passed!");
// V18 END tests/migration024.test.ts

