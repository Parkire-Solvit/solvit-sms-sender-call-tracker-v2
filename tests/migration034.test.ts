// V19 tests/migration034.test.ts
import fs from "node:fs";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for migration 034...");

const root = process.cwd(); // tests are always run from the repository root via npm test
const sqlFile = fs.readFileSync(path.join(root, "migrations", "034_pending_job_types.sql"), "utf8");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
assert(norm(sqlFile).length > 100, "the .sql file is not empty");
assert(sqlFile.includes("ADD COLUMN IF NOT EXISTS job_type VARCHAR(20) NOT NULL DEFAULT 'INSPECTION'"), "adds job_type safely with the inspection default");
assert(sqlFile.includes("ADD COLUMN IF NOT EXISTS type_changed_at TIMESTAMPTZ"), "adds type_changed_at safely");
assert(sqlFile.includes("CREATE INDEX IF NOT EXISTS idx_psj_job_type"), "indexes job_type safely");
assert(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(sqlFile), "the migration never removes data");

console.log("All migration 034 tests passed!");
// V19 END tests/migration034.test.ts
