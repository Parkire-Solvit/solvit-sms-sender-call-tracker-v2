// V19 tests/pendingJobTypesDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function rejects(fn: () => Promise<unknown>, status: number, message: string) {
  try {
    await fn();
  } catch (e: any) {
    assert(e && e.status === status, `${message} (expected HTTP ${status}, got ${e && e.status})`);
    return;
  }
  throw new Error(`Assertion failed: ${message} (nothing was thrown)`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping pending job types DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-jobtypes-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(pathToFileURL(path.join(root, "db.ts")).href);
  const ps = await import(pathToFileURL(path.join(root, "pendingSubmissions.ts")).href);
  const kpi = await import(pathToFileURL(path.join(root, "agentKpiService.ts")).href);
  const db = await initDatabase();

  console.log("Running DB integration tests for Pending job types...");

  const TAG = "Callback Team(Submission)";
  await db.execute("INSERT INTO agents (name, tag, phone_number) VALUES ('Amina', ?, '0711000001')", [TAG]);
  await db.execute("INSERT INTO agents (name, tag, phone_number) VALUES ('Brian', ?, '0711000002')", [TAG]);
  const amina = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Amina'")).id);
  const brian = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Brian'")).id);

  const INS = "Pending Inspection";
  const SUB = "Pending Submission";
  const mk = (id: number, status: string, solver: string, client?: string, extra: Record<string, unknown> = {}) => ({
    external_id: id, job_status: status, solver_name: `Solver ${id}`, solver_contact: solver, solver_email: "",
    vehicle_reg: `KAA ${String(1000 + id)}A`, insurance_company: "Fidelity",
    client_phone: client ?? `0722${String(100000 + id).padStart(6, "0")}`, customer_email: "",
    schedule_date: "2026-01-01T00:00:00.000Z", latest_pending_reason: "x", ...extra,
  });
  const jobOf = async (ext: number) => db.queryOne("SELECT * FROM pending_submission_jobs WHERE external_id = ?", [ext]);

  // ---- 1. First upload: both types, bad rows reported with their details ----
  const first = await ps.importPendingSubmissions(db, "list.xlsx", "Brian", [
    mk(1, INS, "0700000001"), mk(2, INS, "0700000002"), mk(3, INS, ""), // blank solver number is fine for an inspection
    mk(11, SUB, "0733000001"), mk(12, SUB, "0733000001"), mk(13, SUB, "0733000002"), mk(14, SUB, "0733000003"),
    mk(20, SUB, ""),                                  // submission without a solver number: skipped
    mk(21, SUB, "07001"),                             // short solver number: skipped
    mk(22, "Pending Valuation", "0700000009"),        // unrecognised status: skipped
    mk(23, "", "0700000009"),                         // missing status: skipped
    mk(24, INS, "0700000009", "0722"),                // short client number: skipped
    { ...mk(26, INS, "0700000009", ""), row_number: 88, vehicle_reg: "" }, // missing registration: skipped, uses the given row number
  ]);
  assert(first.new_records_count === 7, `seven valid rows are added (got ${first.new_records_count})`);
  assert(first.invalid_rows_count === 6 && first.invalid_rows.length === 6, "every skipped row is listed, none are dropped");
  const bad = (id: string) => first.invalid_rows.find((r: any) => r.external_id === id);
  assert(bad("20").reason.includes("Solver number is missing") && bad("20").vehicle_reg === "KAA 1020A" && bad("20").row === 9, "row 9 lists ID, registration and reason");
  assert(bad("21").reason.includes("fewer than 9 digits"), "short solver number reason");
  assert(bad("22").reason.includes("not recognised") && bad("22").job_status === "Pending Valuation", "unrecognised status reason");
  assert(bad("23").reason.includes("job_status is missing"), "missing status reason");
  assert(bad("24").reason.includes("Client number"), "short client number reason");
  assert(bad("26").row === 88, "a row number supplied by the client is used");
  assert(first.by_type.INSPECTION.new_records === 3 && first.by_type.SUBMISSION.new_records === 4, "by_type counts the new records per type");
  assert((await jobOf(3)).job_type === "INSPECTION" && (await jobOf(11)).job_type === "SUBMISSION", "the job type is stored");

  // ---- 2. Assignment is shared per type, and a solver's jobs stay together ----
  const owner = async (ext: number) => Number((await jobOf(ext)).assigned_agent_id);
  assert((await owner(11)) === (await owner(12)), "two jobs of one solver go to one agent");
  const subOwners = [11, 13, 14].map(owner);
  const subCounts = new Map<number, number>();
  for (const o of await Promise.all(subOwners)) subCounts.set(o, (subCounts.get(o) ?? 0) + 1);
  const subLoad = (await Promise.all([11, 12, 13, 14].map(owner))).reduce((m: Map<number, number>, o) => m.set(o, (m.get(o) ?? 0) + 1), new Map<number, number>());
  assert(subLoad.get(amina) === 2 && subLoad.get(brian) === 2, "submission work is shared equally between the two agents");
  const insLoad = (await Promise.all([1, 2, 3].map(owner))).reduce((m: Map<number, number>, o) => m.set(o, (m.get(o) ?? 0) + 1), new Map<number, number>());
  assert(Math.abs((insLoad.get(amina) ?? 0) - (insLoad.get(brian) ?? 0)) <= 1, "inspection work is shared on its own");

  // ---- 3. Listing, outcomes per type ----
  const insJobs = await ps.getPendingSubmissionJobs(db, { job_type: "INSPECTION" });
  const subJobs = await ps.getPendingSubmissionJobs(db, { job_type: "SUBMISSION" });
  assert(insJobs.length === 3 && subJobs.length === 4, `listing is per type (${insJobs.length}/${subJobs.length})`);
  assert(subJobs.every((j: any) => j.job_type === "SUBMISSION"), "listed jobs carry their type");

  const j11 = Number((await jobOf(11)).id);
  const j1 = Number((await jobOf(1)).id);
  await rejects(() => ps.logPendingSubmissionOutcome(db, j11, { outcome: "SCHEDULED", comment: "", logged_by: "Amina", scheduled_at: new Date(Date.now() + 86400000).toISOString(), scheduled_place: "Yard" }), 400, "Scheduled is not available for a submission job");
  await rejects(() => ps.logPendingSubmissionOutcome(db, j1, { outcome: "SOLVER_SUBMITTED", comment: "", logged_by: "Amina" }), 400, "Submitted is not available for an inspection job");
  const submitted = await ps.logPendingSubmissionOutcome(db, Number((await jobOf(14)).id), { outcome: "SOLVER_SUBMITTED", comment: "", logged_by: "Amina" });
  assert(submitted.job.status === "GREEN" && submitted.job.latest_outcome === "SOLVER_SUBMITTED", "Submitted closes a submission job GREEN");

  // ---- 4. Counting for a submission job uses the solver's number ----
  const solverPhone = ps.normalizePhone("0733000001");
  const clientPhone11 = String((await jobOf(11)).client_phone);
  const ts = (offsetSec: number) => new Date(Date.now() + 20_000 + offsetSec * 1000).toISOString();
  const ev = async (agent: number, type: string, status: string, phone: string, s: number) =>
    db.execute("INSERT INTO events (agent_id, type, target_phone, status, timestamp) VALUES (?, ?, ?, ?, ?)", [agent, type, phone, status, ts(s)]);
  const a11 = await owner(11);
  await ev(a11, "CALL", "OUTGOING", solverPhone, 1);
  await ev(a11, "CALL", "OUTGOING", solverPhone, 2);
  await ev(a11, "CALL", "OUTGOING", clientPhone11, 3); // a call to the client is allowed but not counted
  await ev(a11, "SMS", "SENT", solverPhone, 4);
  const asSubmission = async (ext: number) => { const r = await jobOf(ext); return { ...r, id: Number(r.id), assigned_agent_id: Number(r.assigned_agent_id) }; };
  let act = await ps.computePendingSubmissionActivity(db, [await asSubmission(11)]);
  assert(act.get(j11).client_attempt_count === 2, `two calls to the solver are counted (got ${act.get(j11).client_attempt_count})`);
  assert(act.get(j11).client_sms_count === 1, "the SMS to the solver is counted");

  // ---- 5. A later upload with only inspection rows never closes submission jobs ----
  const second = await ps.importPendingSubmissions(db, "inspections.xlsx", "Brian", [mk(1, INS, "0700000001"), mk(2, INS, "0700000002")], { confirmed: true });
  assert(second.auto_closed_absent_count === 1 && (await jobOf(3)).latest_outcome === "ABSENT_FROM_LATEST_EXPORT", "the missing inspection job is closed as absent");
  assert((await jobOf(11)).status === "AMBER" && (await jobOf(13)).status === "AMBER", "open submission jobs are untouched by an inspection-only upload");
  assert(second.by_type.INSPECTION.auto_closed_absent === 1 && second.by_type.SUBMISSION.auto_closed_absent === 0, "the summary shows the closure by type");

  // ---- 6. An open job that changes type moves and its counts restart ----
  await db.execute("UPDATE pending_submission_jobs SET first_imported_at = ? WHERE external_id = 2", [new Date(Date.now() - 86_400_000).toISOString()]);
  const j2 = Number((await jobOf(2)).id);
  const a2 = await owner(2);
  await db.execute("INSERT INTO events (agent_id, type, target_phone, status, timestamp) VALUES (?, 'CALL', ?, 'OUTGOING', ?)", [a2, String((await jobOf(2)).client_phone), new Date(Date.now() - 3_600_000).toISOString()]);
  act = await ps.computePendingSubmissionActivity(db, [await asSubmission(2)]);
  assert(act.get(j2).client_attempt_count === 1, "before the change the call to the client is counted");
  const third = await ps.importPendingSubmissions(db, "move.xlsx", "Brian", [mk(1, INS, "0700000001"), mk(2, SUB, "0700000002")], { confirmed: true });
  assert(third.type_changed_count === 1 && third.by_type.SUBMISSION.moved_in === 1, "the move is reported");
  const moved = await jobOf(2);
  assert(moved.job_type === "SUBMISSION" && moved.status === "AMBER" && moved.latest_outcome === "TYPE_CHANGED_BY_SYSTEM" && moved.type_changed_at, "the job is now a submission job, open, and marked");
  act = await ps.computePendingSubmissionActivity(db, [await asSubmission(2)]);
  assert(act.get(j2).client_attempt_count === 0, "the attempt count restarts after a type change");
  const log2 = await ps.getPendingSubmissionLogs(db, j2);
  assert(log2.some((l: any) => l.outcome === "TYPE_CHANGED_BY_SYSTEM"), "the move is logged and history is kept");

  // ---- 7. A closed job that reappears as the other type is reopened as a new task ----
  const j14 = Number((await jobOf(14)).id);
  assert((await jobOf(14)).status === "GREEN", "job 14 was closed as Submitted");
  const fourth = await ps.importPendingSubmissions(db, "reopen.xlsx", "Brian", [mk(14, INS, "0733000003")], { confirmed: true });
  const reopened = await jobOf(14);
  assert(reopened.status === "AMBER" && reopened.job_type === "INSPECTION" && reopened.closed_at === null, "reopened in the other tab");
  assert(fourth.type_changed_count === 1, "counted as a type change");
  assert((await ps.getPendingSubmissionLogs(db, j14)).some((l: any) => l.outcome === "SOLVER_SUBMITTED"), "the earlier history is kept");

  // ---- 8. KPI and max attempts report are per type ----
  const kIns = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), "INSPECTION");
  const kSub = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), "SUBMISSION");
  const kAll = await kpi.getPendingSubmissionAgentKpis(db, Date.now());
  const openOf = (r: any) => r.agents.reduce((n: number, a: any) => n + Number(a.open_count ?? a.open ?? 0), 0) + Number(r.unassigned_open ?? 0);
  assert(openOf(kIns) + openOf(kSub) === openOf(kAll) && openOf(kIns) !== openOf(kAll), "the two KPI views add up to the whole and differ from it");
  assert(kSub.upload_closed_label === "Closed by upload", "the upload closure label is renamed");

  await db.execute("UPDATE pending_submission_jobs SET status = 'RED', latest_outcome = 'MAX_ATTEMPTS_REACHED', closed_at = CURRENT_TIMESTAMP WHERE external_id IN (1, 2)");
  const repIns = await ps.getPendingSubmissionMaxAttemptsReport(db, "INSPECTION");
  const repSub = await ps.getPendingSubmissionMaxAttemptsReport(db, "SUBMISSION");
  const n = (r: any[]) => r.reduce((s, g) => s + g.jobs.length, 0);
  assert(n(repIns) === 1 && n(repSub) === 1, `the max attempts report is split by type (${n(repIns)}/${n(repSub)})`);

  // ---- 9. Pure per-type planning ----
  const plan = ps.planAssignmentsByType(
    [{ job_type: "INSPECTION", key: "a" }, { job_type: "SUBMISSION", key: "a" }, { job_type: "SUBMISSION", key: "b" }],
    [{ id: 1, name: "A" }, { id: 2, name: "B" }],
    [{ job_type: "INSPECTION", key: "z", agent_id: 1 }, { job_type: "INSPECTION", key: "y", agent_id: 1 }]
  );
  assert(plan.get("INSPECTION|a") === 2, "an inspection goes to the agent with fewer inspections");
  assert(plan.get("SUBMISSION|a") !== plan.get("SUBMISSION|b"), "submission work is shared on its own, ignoring the inspection load");

  console.log("All Pending job type DB tests passed!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
