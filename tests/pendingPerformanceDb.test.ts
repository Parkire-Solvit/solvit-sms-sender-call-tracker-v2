// tests/pendingPerformanceDb.test.ts
// Original vs latest pending reason, last outcome date, date range on the Agent KPI, the Agent conversion rate,
// and the Max Attempts export (new columns, Overall mode, date range).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping Pending performance DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-perf-test-"));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.chdir(dir);

  const load = (f: string) => import(pathToFileURL(path.join(root, f)).href);
  const { initDatabase } = await load("db.ts");
  const ps = await load("pendingSubmissions.ts");
  const kpi = await load("agentKpiService.ts");
  const rep = await load("pendingMaxAttemptsReport.ts");
  const perf = await load("shared/pendingPerformance.ts");
  const db = await initDatabase();

  console.log("Running DB integration tests for Pending performance...");

  const TAG = "Callback Team(Submission)";
  await db.execute("INSERT INTO agents (name, tag, phone_number) VALUES ('Amina', ?, '0711000001')", [TAG]);

  const INS = "Pending Inspection";
  const SUB = "Pending Submission";
  const mk = (id: number, status: string, reason: string, extra: Record<string, unknown> = {}) => ({
    external_id: id, job_status: status, solver_name: `Solver ${id}`, solver_contact: `0733${String(100000 + id).padStart(6, "0")}`, solver_email: "",
    vehicle_reg: `KAA ${String(1000 + id)}A`, insurance_company: id % 2 ? "Fidelity" : "Britam",
    client_phone: `0722${String(100000 + id).padStart(6, "0")}`, customer_email: "",
    schedule_date: "2026-11-05T07:00:00.000Z", latest_pending_reason: reason, ...extra,
  });
  const jobOf = async (ext: number) => (await ps.getPendingSubmissionJobs(db, {})).find((j: any) => j.external_id === ext);

  // ---- 1. Original reason is recorded on creation and never overwritten ----
  await ps.importPendingSubmissions(db, "a.xlsx", "Admin", [
    mk(1, INS, "No documents"), mk(2, INS, "Client travelling"), mk(3, SUB, "Solver busy"), mk(4, SUB, "Network"), mk(5, INS, "x"),
  ]);
  let j1 = await jobOf(1);
  assert(j1.original_pending_reason === "No documents" && j1.latest_pending_reason === "No documents", "first upload sets both reasons");
  await ps.importPendingSubmissions(db, "b.xlsx", "Admin", [
    mk(1, INS, "Client changed location"), mk(2, INS, "Client travelling"), mk(3, SUB, "Solver busy"), mk(4, SUB, "Network"), mk(5, INS, "x"),
  ], { confirmed: true });
  j1 = await jobOf(1);
  assert(j1.original_pending_reason === "No documents", `the original reason survives a later upload (got ${j1.original_pending_reason})`);
  assert(j1.latest_pending_reason === "Client changed location", "the latest reason follows the upload");

  // A job created before the column existed has no original reason.
  await db.execute("UPDATE pending_submission_jobs SET original_pending_reason = NULL WHERE external_id = 5");
  assert((await jobOf(5)).original_pending_reason === null, "legacy jobs keep a null original reason");
  assert(perf.pendingJobDetailColumns(await jobOf(5))["Original Pending Reason"] === "Not recorded", "and export as Not recorded");

  // ---- 2. Last outcome date: the latest agent outcome, system outcomes excluded ----
  assert((await jobOf(2)).last_outcome_at === null, "no outcome yet");
  const id = async (ext: number) => (await jobOf(ext)).id;
  await ps.logPendingSubmissionOutcome(db, await id(2), { outcome: "NOT_PICKING", comment: "No answer", logged_by: "Amina" });
  const afterAgent = (await jobOf(2)).last_outcome_at;
  assert(afterAgent !== null, "an agent outcome sets the last outcome date");
  await db.execute(
    "INSERT INTO pending_submission_logs (pending_submission_job_id, outcome, comment, logged_by, resulting_status, created_at) VALUES (?, 'MAX_ATTEMPTS_REACHED', 'sys', 'System', 'RED', ?)",
    [await id(2), new Date(Date.now() + 3_600_000).toISOString()]
  );
  assert(String((await jobOf(2)).last_outcome_at) === String(afterAgent), "a system outcome does not move the last outcome date");

  // ---- 3. Agent conversion rate (closed by upload excluded) and the date range on the Agent KPI ----
  await ps.logPendingSubmissionOutcome(db, await id(1), {
    outcome: "SCHEDULED", comment: "Booked", logged_by: "Amina", scheduled_at: "2026-11-25T09:00:00+03:00", scheduled_place: "Westlands",
  });
  await db.execute("UPDATE pending_submission_jobs SET status = 'GREEN', latest_outcome = 'ABSENT_FROM_LATEST_EXPORT', closed_at = CURRENT_TIMESTAMP WHERE external_id = 5");
  const insp = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), "INSPECTION");
  assert(insp.conversion.total === 3 && insp.conversion.green === 1, `inspection: 1 agent conversion of 3, the upload-closed job not counted (got ${JSON.stringify(insp.conversion)})`);
  assert(insp.date_range === null, "no range by default");
  const j1View = await jobOf(1);
  assert(j1View.scheduled_at !== null && perf.pendingJobDetailColumns(j1View)["Inspection Date (Booked by Agent)"] !== "", "the booked inspection date is exported");

  // Move job 3 into an old import period; a range on the imported date leaves it out.
  await db.execute("UPDATE pending_submission_jobs SET first_imported_at = '2026-01-10T08:00:00Z' WHERE external_id = 3");
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const recent = perf.parseDateRangeParams({ date_from: "2026-11-01", date_to: today });
  const sub = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), "SUBMISSION", recent);
  assert(sub.conversion.total === 1, `submission in range: only job 4 (got ${sub.conversion.total})`);
  assert(typeof sub.date_range === "string" && sub.date_range.startsWith("Imported date"), "the report states the range");
  const all = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), undefined, recent);
  assert(all.conversion.total === 4, `overall in range: every job except job 3 (got ${all.conversion.total})`);
  const closedRange = perf.parseDateRangeParams({ date_from: "2026-11-01", date_to: today, date_basis: "CLOSED" });
  const closedOnly = await kpi.getPendingSubmissionAgentKpis(db, Date.now(), undefined, closedRange);
  assert(closedOnly.conversion.total === 2, `closed-date range: only the two closed jobs (got ${closedOnly.conversion.total})`);

  // ---- 4. Max Attempts export: new columns, Overall mode, date range ----
  for (const ext of [2, 4]) {
    await db.execute("UPDATE pending_submission_jobs SET status = 'RED', latest_outcome = 'MAX_ATTEMPTS_REACHED', closed_at = CURRENT_TIMESTAMP WHERE external_id = ?", [ext]);
  }
  const overall = await rep.getPendingMaxAttemptsTimeline(db, "ALL");
  const count = (groups: any[]) => groups.reduce((n: number, g: any) => n + g.records.length, 0);
  assert(count(overall) === 2, "Overall holds max-attempt jobs of both types");
  const out = rep.buildPendingMaxAttemptsWorkbook(overall, "ALL", "ALL", Date.parse("2026-11-19T10:00:00Z"), "ALL", recent);
  assert(out.filename.startsWith("pending_overall_max_attempts_report_"), `overall file name (got ${out.filename})`);
  const wb = XLSX.read(out.buffer, { type: "buffer" });
  assert(wb.SheetNames.includes("Report Info"), "the report states its scope and range");
  const raw = XLSX.utils.sheet_to_json<any>(wb.Sheets["Raw Data"]);
  for (const col of ["Job Type", "Calls (Attempts)", "SMS Sent", "Total Attempts (Calls + SMS)", "Schedule Date (Upload)", "Inspection Date (Booked by Agent)", "Original Pending Reason", "Latest Pending Reason", "Last Outcome Date", "Closed Date"]) {
    assert(col in raw[0], `raw data has the column "${col}"`);
  }
  const summary = XLSX.utils.sheet_to_json<any>(wb.Sheets["Summary"]);
  assert("Total Attempts (Calls + SMS)" in summary[0], "summary has total attempts");
  const info = XLSX.utils.sheet_to_json<any>(wb.Sheets["Report Info"]);
  assert(String(info.find((r: any) => r.Field === "Date range").Value).startsWith("Imported date"), "report info shows the range");

  const old = perf.parseDateRangeParams({ date_from: "2026-01-01", date_to: "2026-01-31" });
  assert(count(rep.filterMaxAttemptsGroupsByDate(overall, old)) === 0, "a range with no imports leaves no records");
  assert(count(rep.filterMaxAttemptsGroupsByDate(overall, null)) === 2, "no range keeps everything");
  const typed = rep.buildPendingMaxAttemptsWorkbook(await rep.getPendingMaxAttemptsTimeline(db, "SUBMISSION"), "ALL", "ALL", Date.now(), "SUBMISSION");
  const typedRaw = XLSX.utils.sheet_to_json<any>(XLSX.read(typed.buffer, { type: "buffer" }).Sheets["Raw Data"]);
  assert(!("Job Type" in typedRaw[0]) && "Solver Phone" in typedRaw[0], "a single-type report keeps its layout");

  console.log("All Pending performance DB tests passed!");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
