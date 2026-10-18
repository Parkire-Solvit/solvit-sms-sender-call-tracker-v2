// V18 tests/pendingMaxAttemptsExcelDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping pending max-attempts DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-maxexcel-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const ps = await import(path.join(root, "pendingSubmissions.ts"));
  const rep = await import(path.join(root, "pendingMaxAttemptsReport.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for the Pending max attempts Excel report...");

  const TAG = "Callback Team(Submission)";
  await db.execute("INSERT INTO agents (name, tag, phone_number) VALUES ('Kelvin', ?, '0711000001')", [TAG]);
  await db.execute("INSERT INTO agents (name, tag, phone_number) VALUES ('Other', 'Some Other Team', '0711000002')");
  const kelvin = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Kelvin'")).id);
  const other = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Other'")).id);

  const mk = (id: number, company: string) => ({
    external_id: id, solver_name: `Solver ${id}`, solver_contact: "0700000001", solver_email: "", vehicle_reg: `KAA ${String(1000 + id)}A`,
    insurance_company: company, client_phone: `0722${String(100000 + id).padStart(6, "0")}`, customer_email: "", schedule_date: "2026-01-01T00:00:00.000Z", latest_pending_reason: "x",
  });
  await ps.importPendingSubmissions(db, "f.xlsx", "Mary", [mk(1, "Fidelity"), mk(2, "Fidelity"), mk(3, "Britam"), mk(4, "Britam")]);
  const jobId = async (ext: number) => Number((await db.queryOne("SELECT id FROM pending_submission_jobs WHERE external_id = ?", [ext])).id);
  const j1 = await jobId(1);
  await ps.logPendingSubmissionOutcome(db, j1, { outcome: "NOT_PICKING", comment: "No answer", logged_by: "Kelvin" });

  const phone1 = "0722100001";
  const when = (s: number) => new Date(Date.now() + 10_000 + s * 1000).toISOString();
  const ev = async (agent: number, type: string, status: string, phone: string, s: number, reg: string | null = null) =>
    db.execute("INSERT INTO events (agent_id, type, target_phone, status, reg_no, timestamp) VALUES (?, ?, ?, ?, ?, ?)", [agent, type, phone, status, reg, when(s)]);
  for (let i = 0; i < 3; i++) await ev(kelvin, "CALL", "OUTGOING", phone1, i);
  await ev(kelvin, "CALL", "INCOMING", phone1, 3);
  await ev(kelvin, "SMS", "SENT", phone1, 4);
  await ev(kelvin, "SMS", "SENT", "0799999999", 5, "KAA 1001A"); // matched by registration
  await ev(other, "SMS", "SENT", phone1, 6); // another agent: must not appear
  await ev(kelvin, "CALL", "OUTGOING", "0788888888", 7); // another number: must not appear

  for (const ext of [1, 2, 3]) {
    await db.execute("UPDATE pending_submission_jobs SET status = 'RED', latest_outcome = 'MAX_ATTEMPTS_REACHED', closed_at = CURRENT_TIMESTAMP WHERE external_id = ?", [ext]);
  }

  const groups = await rep.getPendingMaxAttemptsTimeline(db);
  assert(groups.map((g: any) => g.insurance_company).join() === "Britam,Fidelity", "groups are by insurance company, sorted");
  const fid = groups.find((g: any) => g.insurance_company === "Fidelity");
  assert(fid.records.length === 2, "two Fidelity records reached max attempts");
  const rec1 = fid.records.find((r: any) => r.job.external_id === 1);
  const kinds = rec1.chronology.map((c: any) => c.kind);
  assert(kinds.filter((k: string) => k === "OUTCOME").length === 1, "the outcome trail is included (the agent's logged outcome)");
  assert(kinds.filter((k: string) => k === "CALL").length === 4, "four calls to the client appear");
  assert(kinds.filter((k: string) => k === "SMS").length === 2, "two SMS appear (one by phone, one by registration)");
  assert(rec1.chronology.length === kinds.length && !rec1.chronology.some((c: any) => c.logged_by === "Other"), "events of other agents never appear");
  const counted = rec1.chronology.filter((c: any) => c.counted);
  assert(counted.length === 5, `three outgoing calls and two SMS are counted (got ${counted.length})`);
  assert(rec1.chronology.filter((c: any) => c.kind === "CALL" && !c.counted).length === 1, "the incoming call is shown but not counted");
  const stamps = rec1.chronology.map((c: any) => Date.parse(String(c.timestamp).includes("T") ? c.timestamp : String(c.timestamp).replace(" ", "T") + "Z"));
  assert(stamps.every((t: number, i: number) => i === 0 || t >= stamps[i - 1]), "the trail is in time order");
  const rec2 = fid.records.find((r: any) => r.job.external_id === 2);

  // Workbook layout equals the Callbacks report layout (sheet structure and column headers)
  const out = rep.buildPendingMaxAttemptsWorkbook(groups, "ALL", "ALL", Date.parse("2026-10-17T10:00:00Z"));
  assert(out.filename === "pending_max_attempts_report_all_all_2026-10-17.xlsx", "file name follows the Callbacks pattern");
  const wb = XLSX.read(out.buffer, { type: "buffer" });
  assert(wb.SheetNames.join("|") === "Summary|Britam|Fidelity|Raw Data", "sheets: Summary, one per company, Raw Data");
  const headers = (name: string) => (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 })[0] as string[]).join("|");
  const CALLBACKS_TIMELINE = ["Vehicle Registration", "Client Name", "Client Phone", "Channel Partner", "Timestamp", "Type", "Status / Outcome", "Notes", "Agent Name", "Agent Phone", "Allocated Agent", "Counted Towards Max Attempts"];
  const expected = CALLBACKS_TIMELINE.map((h) => (h === "Client Name" ? "Solver Name" : h === "Channel Partner" ? "Insurance Company" : h === "Allocated Agent" ? "Assigned Agent" : h)).join("|");
  assert(headers("Fidelity") === expected, "company sheet columns mirror the Callbacks columns");
  assert(headers("Raw Data") === expected, "raw data columns are the same");
  assert(headers("Summary") === "Solver Name|Client Phone|Insurance Company(ies)|Vehicles|Vehicle Count|Assigned Agent|Outgoing Calls|SMS Sent", "summary columns mirror the Callbacks summary");
  const fidRows = XLSX.utils.sheet_to_json(wb.Sheets["Fidelity"]) as any[];
  assert(fidRows.filter((r) => r["Counted Towards Max Attempts"] === "Yes").length === 5, "five rows are counted");
  assert(fidRows.some((r) => r["Type"] === "NONE" && r["Status / Outcome"] === "MAX_ATTEMPTS_REACHED"), "a record with no trail still gets a NONE row");
  const raw = XLSX.utils.sheet_to_json(wb.Sheets["Raw Data"]) as any[];
  assert(raw.length === groups.reduce((n: number, g: any) => n + g.records.reduce((m: number, r: any) => m + Math.max(1, r.chronology.length), 0), 0), "raw data holds every row of every sheet");
  const summary = XLSX.utils.sheet_to_json(wb.Sheets["Summary"]) as any[];
  assert(summary.length === 3, "one summary row per client phone");
  const s1 = summary.find((r) => String(r["Client Phone"]).endsWith("100001"));
  assert(s1["Outgoing Calls"] === 3 && s1["SMS Sent"] === 2 && s1["Assigned Agent"] === "Kelvin", "summary carries the counted calls and SMS and the agent");

  // Filters
  assert(rep.filterMaxAttemptsGroups(groups, "UNASSIGNED", "ALL").length === 0, "no record is unassigned");
  assert(rep.filterMaxAttemptsGroups(groups, "kelvin", "ALL").length === 2, "agent filter by name, case-insensitive");
  assert(rep.filterMaxAttemptsGroups(groups, String(kelvin), "ALL").length === 2, "agent filter by id");
  assert(rep.filterMaxAttemptsGroups(groups, "ALL", "britam").length === 1, "company filter, case-insensitive");
  assert(rep.filterMaxAttemptsGroups(groups, String(other), "ALL").length === 0, "another agent has no records");
  const named = rep.buildPendingMaxAttemptsWorkbook(rep.filterMaxAttemptsGroups(groups, "Kelvin", "Fidelity"), "Kelvin", "Fidelity", Date.parse("2026-10-17T10:00:00Z"));
  assert(named.filename === "pending_max_attempts_report_kelvin_fidelity_2026-10-17.xlsx", "file name includes the filters");

  // Empty report still produces a valid workbook
  const empty = rep.buildPendingMaxAttemptsWorkbook([], "ALL", "ALL");
  const ewb = XLSX.read(empty.buffer, { type: "buffer" });
  assert(ewb.SheetNames.join("|") === "Summary|Raw Data", "an empty report has Summary and Raw Data");
  void rec2;

  console.log("All Pending max attempts Excel DB tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
// V18 END tests/pendingMaxAttemptsExcelDb.test.ts

