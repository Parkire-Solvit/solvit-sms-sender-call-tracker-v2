// V15 tests/agentKpiDb.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping agent KPI DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  // Isolated SQLite database in a temp directory. DATABASE_URL must be unset so the SQLite fallback is used.
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kpi-db-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const ps = await import(path.join(root, "pendingSubmissions.ts"));
  const svc = await import(path.join(root, "agentKpiService.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for the agent KPI service...");

  const addEv = (agent: number, type: string, status: string, phone: string, ts: string, reg: string | null = null) =>
    db.execute("INSERT INTO events (agent_id, type, target_phone, status, reg_no, timestamp) VALUES (?, ?, ?, ?, ?, ?)", [agent, type, phone, status, reg, ts]);
  const future = (i: number) => new Date(Date.now() - 500 + i).toISOString();
  const idOf = async (name: string) => Number((await db.queryOne("SELECT id FROM agents WHERE name = ?", [name])).id);

  // ------------------------------------------------------------------ Pending Submissions
  const TAG = "Callback Team(Submission)";
  await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", ["Alice", TAG]);
  await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", ["Bob", TAG]);

  const row = (id: number, client: string, reg: string, schedule: string) => ({
    external_id: id, solver_name: "Sol", solver_contact: "0700000001", solver_email: "", vehicle_reg: reg,
    insurance_company: "Fidelity", client_phone: client, customer_email: "", schedule_date: schedule, latest_pending_reason: "Call back",
  });
  const X = "0722111222", Y = "0733222333", Z = "0744333444", W = "0755444555";
  const all = [
    row(1, X, "KAA 001A", "2026-09-01T00:00:00.000Z"),
    row(2, X, "KAA 002A", "2026-09-02T00:00:00.000Z"),
    row(3, Y, "KAA 003A", "2026-09-03T00:00:00.000Z"),
    row(4, Z, "KAA 004A", "2026-09-04T00:00:00.000Z"),
    row(5, W, "KAA 005A", "2026-09-05T00:00:00.000Z"),
  ];
  await ps.importPendingSubmissions(db, "f.xlsx", "Mary", all);
  let jobs = await ps.getPendingSubmissionJobs(db);
  const agentOf = (ext: number) => Number(jobs.find((j: any) => j.external_id === ext)!.assigned_agent_id);
  const idByExt = (ext: number) => jobs.find((j: any) => j.external_id === ext)!.id;
  await new Promise((resolve) => setTimeout(resolve, 1200)); // first_imported_at has one-second resolution

  await ps.updatePendingSubmissionSettings(db, { max_attempts_grace_minutes: 0 });
  // Customer X: 4 calls and 4 SMS by the assigned agent -> both X records reach the maximums and close RED
  for (let i = 0; i < 4; i++) await addEv(agentOf(1), "CALL", "OUTGOING", "0722111222", future(1 + i));
  for (let i = 0; i < 4; i++) await addEv(agentOf(1), "SMS", "SENT", "0722111222", future(10 + i));
  // Customer Y: 2 calls only
  for (let i = 0; i < 2; i++) await addEv(agentOf(3), "CALL", "OUTGOING", "0733222333", future(1 + i));
  // Customer Z: scheduled by the agent
  await ps.logPendingSubmissionOutcome(db, idByExt(4), { outcome: "SCHEDULED", comment: "agreed", logged_by: "Mary", scheduled_at: "2026-10-20T10:00:00+03:00", scheduled_place: "Westlands" });
  // Customer W: the next upload no longer contains it, so it is closed as absent ("Submitted")
  await ps.importPendingSubmissions(db, "g.xlsx", "Mary", all.filter((r) => r.external_id !== 5), { confirmed: true });
  jobs = await ps.getPendingSubmissionJobs(db);
  assert(jobs.find((j: any) => j.external_id === 5)!.latest_outcome === "ABSENT_FROM_LATEST_EXPORT", "record 5 was closed as absent");

  const report = await svc.getPendingSubmissionAgentKpis(db);
  assert(report.section === "pending_submissions" && report.window_days === 30, "report header");
  assert(report.requirements.calls === 4 && report.requirements.sms === 4, "requirements come from the Pending settings");
  assert(report.upload_closed_label === "Submitted", "Pending labels upload closures as Submitted");
  assert(report.agents.length === 2, "one entry per team agent");

  // Expected values, computed from where each record landed
  const expected = new Map<number, { open: number; completed: number; upload: number; below: number; never: number }>();
  for (const name of ["Alice", "Bob"]) expected.set(name === "Alice" ? await idOf("Alice") : await idOf("Bob"), { open: 0, completed: 0, upload: 0, below: 0, never: 0 });
  expected.get(agentOf(1))!.completed += 2; // records 1 and 2 (customer X) closed RED at the maximums
  expected.get(agentOf(3))!.open += 1;      // record 3 (customer Y) is open with 2 calls
  expected.get(agentOf(3))!.below += 1;
  expected.get(agentOf(4))!.completed += 1; // record 4 scheduled
  expected.get(agentOf(5))!.upload += 1;    // record 5 closed by upload
  for (const k of report.agents) {
    const e = expected.get(k.agent_id)!;
    assert(k.open === e.open, `${k.agent_name}: open ${k.open} expected ${e.open}`);
    assert(k.completed === e.completed, `${k.agent_name}: completed ${k.completed} expected ${e.completed}`);
    assert(k.closed_by_upload === e.upload, `${k.agent_name}: closed_by_upload ${k.closed_by_upload} expected ${e.upload}`);
    assert(k.below_target === e.below, `${k.agent_name}: below_target ${k.below_target} expected ${e.below}`);
    assert(k.in_scope === e.open + e.completed, `${k.agent_name}: in_scope`);
    assert(Array.isArray(k.pace.advice) && k.pace.advice.length > 0, `${k.agent_name}: pace advice present`);
  }
  const yAgent = report.agents.find((k: any) => k.agent_id === agentOf(3))!;
  assert(yAgent.calls_remaining === 2 && yAgent.sms_remaining === 4, `customer Y still needs 2 calls and 4 SMS (got ${yAgent.calls_remaining}/${yAgent.sms_remaining})`);
  assert(yAgent.oldest_open_days !== null && yAgent.oldest_open_days > 30, "age is measured from the schedule date");
  assert(report.unassigned_open === 0, "nothing is unassigned");

  // A second call gives the same numbers
  const again = await svc.getPendingSubmissionAgentKpis(db);
  assert(JSON.stringify(again.agents.map((k: any) => [k.open, k.completed, k.closed_by_upload])) === JSON.stringify(report.agents.map((k: any) => [k.open, k.completed, k.closed_by_upload])), "the report is repeatable");

  // ------------------------------------------------------------------ Insurance Job Callbacks
  await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", ["Dana", "Callback Team"]);
  await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", ["Eli", "Callback Team"]);
  const dana = await idOf("Dana"), eli = await idOf("Eli");
  const nowIso = new Date().toISOString();
  const addJob = (reg: string, phone: string, agent: number, status: string, outcome: string | null, initiated: string, closedAt: string | null) =>
    db.execute(
      `INSERT INTO callback_jobs (vehicle_reg, vehicle_reg_raw, client_name, client_phone, client_phone_raw, channel_partner, initiated_date, status, assigned_agent_id, latest_outcome, closed_at)
       VALUES (?, ?, 'Client', ?, ?, 'Partner', ?, ?, ?, ?, ?)`,
      [reg, reg, phone, phone, initiated, status, agent, outcome, closedAt]
    );
  const d = new Date(Date.now() - 6 * 86_400_000);
  const ddmmyyyy = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  await addJob("KCA001A", "722000001", dana, "AMBER", null, "2026-09-01", null); // will reach 4 calls and 4 SMS
  await addJob("KCA002A", "722000002", dana, "AMBER", null, ddmmyyyy, null);      // 1 call
  await addJob("KCA003A", "722000003", eli, "AMBER", null, "2026-09-02", null);   // nothing
  await addJob("KCA004A", "722000004", eli, "GREEN", "ABSENT_FROM_LATEST_EXPORT", "2026-09-03", nowIso); // closed by upload
  for (let i = 0; i < 4; i++) await addEv(dana, "CALL", "OUTGOING", "0722000001", future(1 + i));
  for (let i = 0; i < 3; i++) await addEv(dana, "SMS", "SENT", "0722000001", future(10 + i));
  await addEv(dana, "SMS", "SENT", "0799999999", future(20), "KCA 001A"); // 4th SMS matched by registration
  await addEv(dana, "CALL", "OUTGOING", "0722000002", future(30));

  const cb = await svc.getCallbackAgentKpis(db);
  assert(cb.section === "callbacks" && cb.upload_closed_label === "Closed by upload", "callbacks report header and label");
  assert(cb.requirements.calls === 4 && cb.requirements.sms === 4, "requirements come from the callback settings");
  const kd = cb.agents.find((k: any) => k.agent_name === "Dana")!;
  const ke = cb.agents.find((k: any) => k.agent_name === "Eli")!;
  assert(kd.completed === 1 && kd.open === 1 && kd.below_target === 1 && kd.in_scope === 2 && kd.completion_rate === 50, `Dana: 1 completed, 1 open below target, 50 percent (got ${JSON.stringify(kd)})`);
  assert(kd.calls_remaining === 3 && kd.sms_remaining === 4, `Dana still needs 3 calls and 4 SMS (got ${kd.calls_remaining}/${kd.sms_remaining})`);
  assert(kd.oldest_open_days === 6, `dd/mm/yyyy initiated date is read (got ${kd.oldest_open_days})`);
  assert(ke.open === 1 && ke.never_contacted === 1 && ke.completed === 0 && ke.closed_by_upload === 1 && ke.completion_rate === 0, `Eli: nothing contacted, one upload closure, 0 percent (got ${JSON.stringify(ke)})`);
  assert(cb.agents.every((k: any) => k.agent_name !== "Alice" && k.agent_name !== "Bob"), "the other section's agents never appear");

  console.log("All agent KPI DB integration tests passed!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
// V15 END tests/agentKpiDb.test.ts

