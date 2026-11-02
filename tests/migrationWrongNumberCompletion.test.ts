import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../migrations/20261102T1015_close_wrong_number_callbacks.sql", import.meta.url),
  "utf8"
);

assert.match(sql, /latest_outcome IN \('WRONG_NUMBER', 'DECLINED', 'VALUED_ELSEWHERE'\)/);
assert.match(sql, /SET status = 'RED'/);
assert.match(sql, /MAX\(l\.created_at\)/);
assert.match(sql, /UPDATE callback_job_logs/);
assert.doesNotMatch(sql, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);

console.log("Wrong-number completion backfill checks passed.");
