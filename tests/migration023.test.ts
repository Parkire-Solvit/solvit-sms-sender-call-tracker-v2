// V18 tests/migration023.test.ts
import fs from "node:fs";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for the data-reset markers migration...");

const root = process.cwd(); // tests are always run from the repository root via npm test
const sqlFile = fs.readFileSync(path.join(root, "migrations", "032_data_reset_markers.sql"), "utf8");

assert(sqlFile.replace(/\s+/g, " ").trim().length > 100, "the .sql file is not empty");
for (const table of ["callback_jobs", "pending_submission_jobs"]) {
  assert(sqlFile.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS created_by_import_id`), `${table} gets created_by_import_id`);
  assert(sqlFile.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS closed_by_import_id`), `${table} gets closed_by_import_id`);
}
for (const table of ["callback_imports", "pending_submission_imports"]) {
  assert(sqlFile.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS reverted_at`), `${table} gets reverted_at`);
}
assert(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(sqlFile), "the migration never removes data");

console.log("All data-reset markers migration tests passed!");
// V18 END tests/migration023.test.ts

