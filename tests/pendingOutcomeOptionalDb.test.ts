// V18 tests/pendingOutcomeOptionalDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping optional pending-outcome DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-optional-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const ps = await import(path.join(root, "pendingSubmissions.ts"));
  const sw = await import(path.join(root, "solverSmsSwitch.ts"));
  const { HttpError } = await import(path.join(root, "httpError.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for optional notes and schedule details...");

  const mk = (id: number) => ({
    external_id: id, solver_name: "Sol", solver_contact: "0700000001", solver_email: "", vehicle_reg: `KAA ${String(1000 + id)}A`,
    insurance_company: "Fidelity", client_phone: `0722${String(100000 + id).padStart(6, "0")}`, customer_email: "", schedule_date: "2026-01-01T00:00:00.000Z", latest_pending_reason: "x",
  });
  await ps.importPendingSubmissions(db, "f.xlsx", "Mary", [1, 2, 3, 4, 5].map(mk));
  const idOf = async (ext: number) => Number((await db.queryOne("SELECT id FROM pending_submission_jobs WHERE external_id = ?", [ext])).id);
  const expectHttp = async (status: number, label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e: any) {
      assert(e instanceof HttpError && e.status === status, `${label}: expected HTTP ${status}, got ${e?.status ?? e}`);
      return;
    }
    throw new Error(`Assertion failed: ${label}: expected an error`);
  };

  // A note is optional.
  const j1 = await idOf(1);
  let res = await ps.logPendingSubmissionOutcome(db, j1, { outcome: "CALL_BACK", logged_by: "Mary" });
  assert(res.job.status === "AMBER" && res.job.latest_outcome === "CALL_BACK", "an outcome with no note saves and keeps the record open");
  res = await ps.logPendingSubmissionOutcome(db, j1, { outcome: "NOT_PICKING", comment: "   ", logged_by: "Mary" });
  assert(res.job.latest_outcome === "NOT_PICKING", "a blank note also saves");
  const logs = await db.queryAll("SELECT comment FROM pending_submission_logs WHERE pending_submission_job_id = ? ORDER BY id", [j1]);
  assert(logs.length === 2 && logs.every((l: any) => l.comment === ""), "the stored note is an empty string, never null");

  // Scheduled needs no date, time or place.
  const j2 = await idOf(2);
  res = await ps.logPendingSubmissionOutcome(db, j2, { outcome: "SCHEDULED", logged_by: "Mary" });
  assert(res.job.status === "GREEN" && res.job.latest_outcome === "SCHEDULED" && res.job.closed_at !== null, "SCHEDULED closes GREEN with nothing else");
  assert(res.job.scheduled_at === null && res.job.scheduled_place === null, "no schedule details are stored");
  assert(res.job.solver_notification_status === null, "no solver notification state is created");

  // Optional details are still accepted when supplied (nothing breaks for older callers).
  const j3 = await idOf(3);
  res = await ps.logPendingSubmissionOutcome(db, j3, { outcome: "SCHEDULED", comment: "agreed", scheduled_at: "2026-10-20T10:00:00+03:00", scheduled_place: "Westlands" });
  assert(res.job.status === "GREEN" && res.job.scheduled_place === "Westlands", "supplied details are stored");

  // Bad values are still refused.
  const j4 = await idOf(4);
  await expectHttp(400, "invalid schedule time", () => ps.logPendingSubmissionOutcome(db, j4, { outcome: "SCHEDULED", scheduled_at: "not a date" }));
  await expectHttp(400, "unknown outcome", () => ps.logPendingSubmissionOutcome(db, j4, { outcome: "NOPE" }));
  await expectHttp(400, "overlong note", () => ps.logPendingSubmissionOutcome(db, j4, { outcome: "CALL_BACK", comment: "x".repeat(2001) }));
  await expectHttp(409, "closed record", () => ps.logPendingSubmissionOutcome(db, j2, { outcome: "CALL_BACK" }));
  const stillOpen = await db.queryOne("SELECT status FROM pending_submission_jobs WHERE id = ?", [j4]);
  assert(stillOpen.status === "AMBER", "refused saves change nothing");

  // The solver SMS master switch is off unless the server says exactly true.
  const saved = process.env.SOLVER_SMS_ENABLED;
  delete process.env.SOLVER_SMS_ENABLED;
  assert(sw.isSolverSmsEnabled() === false, "unset means off");
  for (const v of ["", "false", "0", "1", "yes", "on", "enabled", " "]) {
    process.env.SOLVER_SMS_ENABLED = v;
    assert(sw.isSolverSmsEnabled() === false, `"${v}" means off`);
  }
  for (const v of ["true", "TRUE", " True "]) {
    process.env.SOLVER_SMS_ENABLED = v;
    assert(sw.isSolverSmsEnabled() === true, `"${v}" means on`);
  }
  if (saved === undefined) delete process.env.SOLVER_SMS_ENABLED;
  else process.env.SOLVER_SMS_ENABLED = saved;

  console.log("All optional note and schedule DB tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
// V18 END tests/pendingOutcomeOptionalDb.test.ts

