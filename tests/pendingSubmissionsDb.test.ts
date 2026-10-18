// FIXPASS tests/pendingSubmissionsDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function expectHttp(status: number, label: string, fn: () => Promise<unknown>, HttpError: any) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof HttpError && (e as any).status === status, `${label}: expected HTTP ${status}, got ${(e as any)?.status ?? e}`);
    return;
  }
  throw new Error(`Assertion failed: ${label}: expected HTTP ${status} but nothing was thrown`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping pending submissions DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  // Isolated SQLite database in a temp directory. DATABASE_URL must be unset so the SQLite fallback is used.
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-db-test-"));
  // Default: throwaway SQLite. Set TEST_DATABASE_URL to run the identical test against PostgreSQL (use an EMPTY database).
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const ps = await import(path.join(root, "pendingSubmissions.ts"));
  const { HttpError } = await import(path.join(root, "httpError.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for pendingSubmissions...");

  const TAG = "Callback Team(Submission)";
  // Never rely on lastInsertId here: the PostgreSQL adapter only returns it for statements with RETURNING id.
  await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", ["Alice", TAG]);
  await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", ["Bob", TAG]);
  await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", ["Carol", "Insurance Callback Team"]);
  const alice = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Alice'")).id);
  const bob = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Bob'")).id);

  const longAgo = "2026-01-01T00:00:00.000Z";
  const row = (id: number, client: string, solver: string, reg: string) => ({
    external_id: id,
    solver_name: "Sol " + id,
    solver_contact: solver,
    solver_email: "",
    vehicle_reg: reg,
    insurance_company: "Fidelity",
    client_phone: client,
    customer_email: "",
    schedule_date: longAgo,
    latest_pending_reason: "Call back",
  });
  const X = "0722111222", Y = "0733222333", Z = "0744333444";
  const rows4 = [row(1, X, "0700000001", "KAA 001A"), row(2, X, "0700000001", "KAA 002A"), row(3, Y, "0700000002", "KAA 003A"), row(4, Z, "0700000003", "KAA 004A")];

  // --- import: assignment ---
  let r: any = await ps.importPendingSubmissions(db, "f.xlsx", "Mary", rows4);
  assert(r.new_records_count === 4 && r.skipped_open_count === 0 && r.auto_closed_absent_count === 0, "first import adds 4");
  let jobs = await ps.getPendingSubmissionJobs(db);
  const agentOf = (id: number) => jobs.find((j: any) => j.external_id === id)!.assigned_agent_id;
  assert(agentOf(1) === agentOf(2), "one client's vehicles go to one agent");
  const perAgent = new Map<number, number>();
  for (const j of jobs) perAgent.set(j.assigned_agent_id!, (perAgent.get(j.assigned_agent_id!) ?? 0) + 1);
  assert(perAgent.get(alice) === 2 && perAgent.get(bob) === 2, "split is equal (2 and 2)");
  assert(jobs.every((j: any) => j.is_overdue === true && j.days_overdue > 0), "old schedule_date means overdue");
  assert(jobs.every((j: any) => j.client_attempt_count === 0 && j.solver_attempt_count === 0), "no attempts yet");

  // --- import: idempotent ---
  r = await ps.importPendingSubmissions(db, "f.xlsx", "Mary", rows4);
  assert(r.new_records_count === 0 && r.skipped_open_count === 4, "same file twice adds nothing");

  // --- import: sticky client ---
  r = await ps.importPendingSubmissions(db, "f.xlsx", "Mary", [...rows4, row(5, X, "0700000001", "KAA 005A")]);
  jobs = await ps.getPendingSubmissionJobs(db);
  assert(agentOf(5) === agentOf(1), "a returning client keeps their agent");

  // --- import: invalid and duplicate rows ---
  r = await ps.importPendingSubmissions(db, "f.xlsx", "Mary", [
    ...rows4, row(5, X, "0700000001", "KAA 005A"),
    row(5, X, "0700000001", "KAA 005A"),
    { ...row(6, "123", "1", "KAA 006A") },
    { ...row(7, Y, "1", "") },
  ]);
  assert(r.duplicate_in_file_count === 1 && r.invalid_rows_count === 2, "duplicates and invalid rows are counted");

  // --- import: safety check writes nothing until confirmed ---
  const before = await db.queryOne("SELECT COUNT(*) AS c FROM pending_submission_jobs WHERE status = 'AMBER'");
  const conf: any = await ps.importPendingSubmissions(db, "f.xlsx", "Mary", [rows4[0]]);
  assert(conf.requires_confirmation === true && conf.would_close_count === 4 && conf.total_open === 5, "confirmation required with correct numbers");
  const afterDry = await db.queryOne("SELECT COUNT(*) AS c FROM pending_submission_jobs WHERE status = 'AMBER'");
  assert(Number(afterDry.c) === Number(before.c), "nothing was written before confirmation");
  const logsDry = await db.queryOne("SELECT COUNT(*) AS c FROM pending_submission_logs");
  assert(Number(logsDry.c) === 0, "no log rows before confirmation");
  r = await ps.importPendingSubmissions(db, "f.xlsx", "Mary", [rows4[0]], { confirmed: true });
  assert(r.auto_closed_absent_count === 4, "confirmed import closes the 4 absent records");
  const absentLog = await db.queryOne("SELECT outcome, logged_by, resulting_status FROM pending_submission_logs WHERE outcome = 'ABSENT_FROM_LATEST_EXPORT' LIMIT 1");
  assert(absentLog && absentLog.logged_by === "System" && absentLog.resulting_status === "GREEN", "absent close uses the correct outcome");

  // --- import: reappearing record reopens ---
  r = await ps.importPendingSubmissions(db, "f.xlsx", "Mary", [...rows4, row(5, X, "0700000001", "KAA 005A")]);
  assert(r.reopened_count === 4, "four previously absent-closed records reopen (row 1 stayed open)");
  jobs = await ps.getPendingSubmissionJobs(db);
  assert(jobs.filter((j: any) => j.status === "AMBER").length === 5, "five open again");

  // --- outcome logging: validation ---
  const j1 = jobs.find((j: any) => j.external_id === 1)!.id;
  await expectHttp(400, "unknown outcome", () => ps.logPendingSubmissionOutcome(db, j1, { outcome: "CLIENT_REFUSED", comment: "x" }), HttpError);
  await expectHttp(400, "system outcome", () => ps.logPendingSubmissionOutcome(db, j1, { outcome: "MAX_ATTEMPTS_REACHED", comment: "x" }), HttpError);
  // The note and the schedule details are optional now (the agent only records the outcome).
  await expectHttp(400, "scheduled with an invalid time", () => ps.logPendingSubmissionOutcome(db, j1, { outcome: "SCHEDULED", scheduled_at: "not a date" }), HttpError);
  await expectHttp(404, "missing job", () => ps.logPendingSubmissionOutcome(db, 99999, { outcome: "CALL_BACK", comment: "x" }), HttpError);

  // --- outcome logging: status mapping ---
  for (const o of ["WRONG_NUMBER", "UNREACHABLE", "CALL_BACK", "NOT_PICKING"]) {
    const res = await ps.logPendingSubmissionOutcome(db, j1, { outcome: o, comment: "tried", logged_by: "Mary" });
    assert(res.job.status === "AMBER" && res.job.latest_outcome === o, `${o} keeps the record AMBER`);
  }
  const sched = await ps.logPendingSubmissionOutcome(db, j1, {
    outcome: "SCHEDULED", comment: "agreed", logged_by: "Mary",
    scheduled_at: "2026-10-20T10:00:00+03:00", scheduled_place: "Westlands",
  });
  assert(sched.job.status === "GREEN" && new Date(sched.job.scheduled_at as any).toISOString() === "2026-10-20T07:00:00.000Z" && sched.job.scheduled_place === "Westlands", "SCHEDULED closes GREEN with stored time and place");
  await expectHttp(409, "closed record", () => ps.logPendingSubmissionOutcome(db, j1, { outcome: "CALL_BACK", comment: "again" }), HttpError);
  const j3 = jobs.find((j: any) => j.external_id === 3)!.id;
  const wd = await ps.logPendingSubmissionOutcome(db, j3, { outcome: "WITHDRAWN", comment: "client withdrew" });
  assert(wd.job.status === "RED" && wd.job.closed_at !== null, "WITHDRAWN closes RED");

  // --- attempts and max-attempts closing: calls AND SMS by the ASSIGNED agent (same rule as Insurance Job Callbacks) ---
  const j2 = jobs.find((j: any) => j.external_id === 2)!;
  const j4 = jobs.find((j: any) => j.external_id === 4)!;
  const xAgent = Number(j2.assigned_agent_id); // the agent who owns customer X
  const otherAgent = xAgent === alice ? bob : alice;
  const addEv = (agent: number, type: string, status: string, phone: string, ts: string, reg: string | null = null) =>
    db.execute("INSERT INTO events (agent_id, type, target_phone, status, reg_no, timestamp) VALUES (?, ?, ?, ?, ?, ?)", [agent, type, phone, status, reg, ts]);
  // first_imported_at has one-second resolution, so wait before creating "after import" events.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const future = (i: number) => new Date(Date.now() - 500 + i).toISOString(); // after first_imported_at, never in the future
  // Customer X: 3 OUTGOING calls by the assigned agent + 1 CONNECTED (must not count) + 1 outgoing BEFORE import (must not count)
  for (let i = 0; i < 3; i++) await addEv(xAgent, "CALL", "OUTGOING", "+254722111222", future(1 + i));
  await addEv(xAgent, "CALL", "CONNECTED", "0722111222", future(5));
  await addEv(xAgent, "CALL", "OUTGOING", "0722111222", "2025-01-01T00:00:00.000Z");
  // Another agent on the same team calling X does NOT count: only the assigned agent's activity counts
  for (let i = 0; i < 10; i++) await addEv(otherAgent, "CALL", "OUTGOING", "0722111222", future(1 + i));
  // Solver calls for job 4 (solver 0700000003) must never close it
  for (let i = 0; i < 10; i++) await addEv(bob, "CALL", "OUTGOING", "0700000003", future(1 + i));
  // Events by an agent on another team must not count
  const carol = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Carol'")).id);
  for (let i = 0; i < 10; i++) await addEv(carol, "CALL", "OUTGOING", "0722111222", future(1 + i));

  await ps.updatePendingSubmissionSettings(db, { max_attempts_grace_minutes: 0 });
  let list = await ps.getPendingSubmissionJobs(db);
  const v2 = list.find((j: any) => j.external_id === 2)!;
  assert(v2.client_attempt_count === 3, `client calls count only the assigned agent's OUTGOING calls after import (got ${v2.client_attempt_count})`);
  assert(v2.status === "AMBER", "3 of 4 calls does not close");
  const v4 = list.find((j: any) => j.external_id === 4)!;
  assert(v4.solver_attempt_count === 10 && v4.client_attempt_count === 0, "solver attempts are counted separately");

  // The 4th call alone does not close: SMS are required too
  await addEv(xAgent, "CALL", "OUTGOING", "0722111222", future(10));
  assert((await ps.closeMaturedPendingSubmissions(db)) === 0, "4 calls and 0 SMS does not close the record");
  // Three SMS by phone: still not enough
  for (let i = 0; i < 3; i++) await addEv(xAgent, "SMS", "SENT", "0722111222", future(11 + i));
  assert((await ps.closeMaturedPendingSubmissions(db)) === 0, "4 calls and 3 SMS does not close the record");
  list = await ps.getPendingSubmissionJobs(db);
  const v2b = list.find((j: any) => j.external_id === 2)!;
  assert(v2b.client_attempt_count === 4 && v2b.client_sms_count === 3, `job 2 shows 4 calls and 3 SMS (got ${v2b.client_attempt_count}/${v2b.client_sms_count})`);
  // The 4th SMS is matched by REGISTRATION only (a different phone number): it counts for job 2 alone
  await addEv(xAgent, "SMS", "SENT", "0700123456", future(15), "KAA 002A");
  assert((await ps.closeMaturedPendingSubmissions(db)) === 1, "4 calls and 4 SMS (the last matched by registration) closes job 2 only");
  list = await ps.getPendingSubmissionJobs(db);
  const c2 = list.find((j: any) => j.external_id === 2)!;
  assert(c2.status === "RED" && c2.latest_outcome === "MAX_ATTEMPTS_REACHED", "closed RED as MAX_ATTEMPTS_REACHED");
  assert(list.find((j: any) => j.external_id === 4)!.status === "AMBER", "10 solver calls did not close job 4");
  assert(list.find((j: any) => j.external_id === 5)!.status === "AMBER", "job 5 (same customer, 3 phone SMS) stays open");
  assert((await ps.closeMaturedPendingSubmissions(db)) === 0, "a second sweep closes nothing more");
  const maxLogs = await db.queryOne("SELECT COUNT(*) AS c FROM pending_submission_logs WHERE pending_submission_job_id = ? AND outcome = 'MAX_ATTEMPTS_REACHED'", [c2.id]);
  assert(Number(maxLogs.c) === 1, "exactly one MAX_ATTEMPTS_REACHED log row");
  const report = await ps.getPendingSubmissionMaxAttemptsReport(db);
  assert(report.length === 1 && report[0].insurance_company === "Fidelity" && report[0].jobs[0].logs.length >= 1, "report groups by company with history");

  // grace period is respected: it runs from the latest counted call OR SMS
  await ps.updatePendingSubmissionSettings(db, { max_attempts_grace_minutes: 1440 });
  const j5 = list.find((j: any) => j.external_id === 5)!;
  await addEv(xAgent, "SMS", "SENT", "0722111222", new Date().toISOString());
  assert((await ps.closeMaturedPendingSubmissions(db, { jobId: j5.id })) === 0, "a 1440 minute grace period prevents closing a record whose latest contact is fresh");
  await ps.updatePendingSubmissionSettings(db, { max_attempts_grace_minutes: 0 });
  assert((await ps.closeMaturedPendingSubmissions(db, { jobId: j5.id })) === 1, "with no grace period the same record closes (4 calls, 4 SMS)");

  // --- settings ---
  await expectHttp(400, "max_attempts out of range", () => ps.updatePendingSubmissionSettings(db, { max_attempts: 0 }), HttpError);
  await expectHttp(400, "max_sms_attempts out of range", () => ps.updatePendingSubmissionSettings(db, { max_sms_attempts: 0 }), HttpError);
  await expectHttp(400, "max_sms_attempts too high", () => ps.updatePendingSubmissionSettings(db, { max_sms_attempts: 21 }), HttpError);
  await expectHttp(400, "percentage out of range", () => ps.updatePendingSubmissionSettings(db, { disappearance_alert_percentage: 101 }), HttpError);
  await expectHttp(400, "bad template", () => ps.updatePendingSubmissionSettings(db, { solver_sms_template: "hello {nope}" }), HttpError);
  const s = await ps.updatePendingSubmissionSettings(db, { max_attempts: 5, max_sms_attempts: 6, callback_team_tag: "HACK", id: 99, solver_sms_auto_send: false });
  assert(s.max_attempts === 5 && s.max_sms_attempts === 6 && s.callback_team_tag === TAG && s.solver_sms_auto_send === false, "valid changes saved, read-only keys ignored");
  assert((await ps.getPendingSubmissionSettings(db)).max_sms_attempts === 6, "max_sms_attempts is stored");
  const changeLog = await db.queryAll("SELECT setting_key FROM settings_change_log WHERE setting_key LIKE 'pending_submissions.%'");
  assert(changeLog.some((c: any) => c.setting_key === "pending_submissions.max_attempts"), "changes are written to settings_change_log");
  assert(changeLog.some((c: any) => c.setting_key === "pending_submissions.max_sms_attempts"), "max_sms_attempts changes are written to settings_change_log");

  console.log("All pendingSubmissions DB integration tests passed!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
// FIXPASS END tests/pendingSubmissionsDb.test.ts

