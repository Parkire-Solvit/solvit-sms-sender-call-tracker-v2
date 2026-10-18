// V18 tests/dataResetCore.test.ts
import {
  parseResetSection,
  verifyResetKey,
  isResetKeyConfigured,
  resetThrottleForTests,
  issueBackupToken,
  consumeBackupToken,
  UNDO_PHRASE,
} from "../dataReset";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function statusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (e: any) {
    return typeof e?.status === "number" ? e.status : -1;
  }
  return 0;
}

console.log("Running core tests for data reset...");

// Sections
assert(parseResetSection("callbacks").jobs === "callback_jobs", "callbacks maps to callback_jobs");
assert(parseResetSection("pending-submissions").jobs === "pending_submission_jobs", "pending maps to pending_submission_jobs");
assert(statusOf(() => parseResetSection("agents")) === 404, "unknown section is a 404");
assert(statusOf(() => parseResetSection("callback_jobs; DROP TABLE agents")) === 404, "injection attempt is a 404");
assert(statusOf(() => parseResetSection(undefined)) === 404, "missing section is a 404");
assert(parseResetSection("callbacks").deleteAllPhrase !== parseResetSection("pending-submissions").deleteAllPhrase, "the two sections need different phrases");
assert(UNDO_PHRASE === "REMOVE LAST UPLOAD", "undo phrase is fixed");

// Key not configured: fail closed
delete process.env.DATA_RESET_KEY;
resetThrottleForTests();
assert(isResetKeyConfigured() === false, "no key means not configured");
assert(statusOf(() => verifyResetKey("anything")) === 403, "no key configured refuses");
process.env.DATA_RESET_KEY = "short";
assert(isResetKeyConfigured() === false, "a key shorter than 12 characters is not accepted");
assert(statusOf(() => verifyResetKey("short")) === 403, "short configured key refuses even when matched");

// Key configured
process.env.DATA_RESET_KEY = "correct-horse-battery";
resetThrottleForTests();
assert(isResetKeyConfigured() === true, "12 or more characters is configured");
assert(statusOf(() => verifyResetKey("correct-horse-battery")) === 0, "the right key passes");
assert(statusOf(() => verifyResetKey("correct-horse-batterz")) === 403, "a wrong key is refused");
assert(statusOf(() => verifyResetKey("")) === 403, "an empty key is refused");
assert(statusOf(() => verifyResetKey(undefined)) === 403, "a missing key is refused");
assert(statusOf(() => verifyResetKey(12345)) === 403, "a non-string key is refused");

// Throttle: five wrong keys lock the feature for 15 minutes, even for the right key
resetThrottleForTests();
const t0 = 1_000_000_000_000;
for (let i = 0; i < 5; i++) assert(statusOf(() => verifyResetKey("wrong-key-value", t0 + i * 1000)) === 403, `wrong attempt ${i + 1} is a 403`);
assert(statusOf(() => verifyResetKey("correct-horse-battery", t0 + 10_000)) === 429, "locked even for the right key");
assert(statusOf(() => verifyResetKey("correct-horse-battery", t0 + 16 * 60 * 1000)) === 0, "unlocks after 15 minutes");

// A success clears earlier failures
resetThrottleForTests();
for (let i = 0; i < 4; i++) statusOf(() => verifyResetKey("nope", t0 + i));
assert(statusOf(() => verifyResetKey("correct-horse-battery", t0 + 10)) === 0, "right key passes before the limit");
for (let i = 0; i < 4; i++) statusOf(() => verifyResetKey("nope", t0 + 20 + i));
assert(statusOf(() => verifyResetKey("correct-horse-battery", t0 + 30)) === 0, "failures were cleared by the success");

// Failures outside the window do not count
resetThrottleForTests();
for (let i = 0; i < 4; i++) statusOf(() => verifyResetKey("nope", t0 + i));
assert(statusOf(() => verifyResetKey("nope", t0 + 16 * 60 * 1000)) === 403, "old failures expire and this one is only a 403");
assert(statusOf(() => verifyResetKey("correct-horse-battery", t0 + 16 * 60 * 1000 + 1)) === 0, "not locked");

// Backup tokens
const now = 2_000_000_000_000;
const tok = issueBackupToken("callbacks", "fp-1", now);
assert(typeof tok === "string" && tok.length >= 32, "token is long and random");
assert(statusOf(() => consumeBackupToken(tok, "callbacks", "fp-1", now + 1000)) === 0, "token works once");
assert(statusOf(() => consumeBackupToken(tok, "callbacks", "fp-1", now + 1000)) === 409, "token cannot be reused");
const tok2 = issueBackupToken("callbacks", "fp-1", now);
assert(statusOf(() => consumeBackupToken(tok2, "pending-submissions", "fp-1", now + 1000)) === 409, "token is bound to its section");
const tok3 = issueBackupToken("callbacks", "fp-1", now);
assert(statusOf(() => consumeBackupToken(tok3, "callbacks", "fp-2", now + 1000)) === 409, "token is rejected when the data changed");
const tok4 = issueBackupToken("callbacks", "fp-1", now);
assert(statusOf(() => consumeBackupToken(tok4, "callbacks", "fp-1", now + 21 * 60 * 1000)) === 409, "token expires after 20 minutes");
assert(statusOf(() => consumeBackupToken("", "callbacks", "fp-1", now)) === 409, "empty token is refused");
assert(statusOf(() => consumeBackupToken("not-a-token", "callbacks", "fp-1", now)) === 409, "unknown token is refused");

// Token store is bounded
for (let i = 0; i < 80; i++) issueBackupToken("callbacks", "fp-x", now);
assert(statusOf(() => consumeBackupToken(tok, "callbacks", "fp-1", now)) === 409, "old tokens are gone");

console.log("All data reset core tests passed!");
// V18 END tests/dataResetCore.test.ts

