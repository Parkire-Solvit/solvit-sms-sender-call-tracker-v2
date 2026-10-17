// FIXPASS tests/pendingSubmissionsTeamDb.test.ts
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
    console.log("Skipping pending submissions team DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-team-test-"));
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.chdir(dir);

  const { initDatabase } = await import(path.join(root, "db.ts"));
  const ps = await import(path.join(root, "pendingSubmissions.ts"));
  const { HttpError } = await import(path.join(root, "httpError.ts"));
  const db = await initDatabase();

  console.log("Running DB integration tests for team overview and reassignment...");

  const TAG = "Callback Team(Submission)";
  for (const n of ["Alice", "Bob", "Zed"]) await db.execute("INSERT INTO agents (name, tag) VALUES (?, ?)", [n, TAG]);
  const idOfAgent = async (n: string) => Number((await db.queryOne("SELECT id FROM agents WHERE name = ?", [n])).id);
  const alice = await idOfAgent("Alice"), bob = await idOfAgent("Bob"), zed = await idOfAgent("Zed");

  const mk = (id: number, client: string, reg: string) => ({
    external_id: id, solver_name: "Sol", solver_contact: "0700000001", solver_email: "", vehicle_reg: reg,
    insurance_company: "Fidelity", client_phone: client, customer_email: "", schedule_date: "2026-01-01T00:00:00.000Z", latest_pending_reason: "x",
  });
  const rows = [];
  for (let i = 1; i <= 9; i++) rows.push(mk(i, `07221110${String(i).padStart(2, "0")}`, `KAA 00${i}A`));
  rows.push(mk(10, "0722111001", "KAA 010A")); // same client as job 1
  await ps.importPendingSubmissions(db, "f.xlsx", "Mary", rows);

  const jobs = async () => (await ps.getPendingSubmissionJobs(db)) as any[];
  let team = await ps.getPendingSubmissionTeam(db);
  assert(team.agents.length === 3 && team.unassigned_open_count === 0 && team.orphaned_open_count === 0, "healthy team at the start");
  assert(team.agents.reduce((a: number, x: any) => a + x.open_count, 0) === 10, "all 10 open jobs are held by tagged agents");

  // Zed leaves the team (retagged). One extra job loses its agent. One GREEN job loses its agent too.
  await db.execute("UPDATE agents SET tag = 'Someone Else' WHERE id = ?", [zed]);
  const zedJobsBefore = (await jobs()).filter((j) => j.assigned_agent_id === zed).map((j) => j.id);
  assert(zedJobsBefore.length > 0, "Zed held jobs");
  const heldByActive = (await jobs()).filter((j) => j.assigned_agent_id === alice || j.assigned_agent_id === bob);
  const spare = heldByActive[0];
  await db.execute("UPDATE pending_submission_jobs SET assigned_agent_id = NULL WHERE id = ?", [spare.id]);
  const greenJob = heldByActive[1];
  await ps.logPendingSubmissionOutcome(db, greenJob.id, { outcome: "SCHEDULED", comment: "ok", logged_by: "Mary", scheduled_at: "2026-10-14T10:30:00+03:00", scheduled_place: "X" });
  await db.execute("UPDATE pending_submission_jobs SET assigned_agent_id = NULL WHERE id = ?", [greenJob.id]);

  team = await ps.getPendingSubmissionTeam(db);
  assert(team.agents.length === 2, "only tagged active agents are listed");
  assert(team.orphaned_open_count === zedJobsBefore.length, `orphaned count (${team.orphaned_open_count} vs ${zedJobsBefore.length})`);
  assert(team.unassigned_open_count === 1, "one unassigned open job (the GREEN one is not open)");

  // Dry run changes nothing.
  const snapshot = JSON.stringify((await jobs()).map((j) => [j.id, j.assigned_agent_id]));
  let r = await ps.reassignOpenSubmissions(db, { dryRun: true });
  assert(r.dry_run === true && r.records === zedJobsBefore.length + 1 && r.agents_used >= 1, "dry run reports the pool");
  assert(JSON.stringify((await jobs()).map((j) => [j.id, j.assigned_agent_id])) === snapshot, "dry run writes nothing");

  // Real run.
  const keptBefore = new Map((await jobs()).filter((j) => (j.assigned_agent_id === alice || j.assigned_agent_id === bob) && j.status === "AMBER").map((j) => [j.id, j.assigned_agent_id]));
  r = await ps.reassignOpenSubmissions(db, { dryRun: false });
  assert(r.dry_run === false && r.records === zedJobsBefore.length + 1, "real run moves the pool");
  const after = await jobs();
  for (const [id, agentId] of keptBefore) assert(after.find((j) => j.id === id).assigned_agent_id === agentId, "jobs held by active agents are never touched");
  const openAfter = after.filter((j) => j.status === "AMBER");
  assert(openAfter.every((j) => j.assigned_agent_id === alice || j.assigned_agent_id === bob), "every open job now belongs to an active tagged agent");
  assert(after.find((j) => j.id === greenJob.id).assigned_agent_id === null, "closed (GREEN) jobs are never touched");
  const agentByClient = new Map<string, number>();
  for (const j of openAfter) {
    const prior = agentByClient.get(j.client_phone);
    assert(prior === undefined || prior === j.assigned_agent_id, "one client is never split across agents");
    agentByClient.set(j.client_phone, j.assigned_agent_id);
  }
  const aCount = openAfter.filter((j) => j.assigned_agent_id === alice).length;
  const bCount = openAfter.filter((j) => j.assigned_agent_id === bob).length;
  assert(Math.abs(aCount - bCount) <= 2, `load is balanced (${aCount} vs ${bCount})`);

  // Second run is a no-op.
  r = await ps.reassignOpenSubmissions(db, { dryRun: false });
  assert(r.records === 0, "nothing left to reassign");

  // No active agents -> 409 for both modes.
  await db.execute("UPDATE agents SET tag = 'Someone Else' WHERE id IN (?, ?)", [alice, bob]);
  await expectHttp(409, "no agents (dry run)", () => ps.reassignOpenSubmissions(db, { dryRun: true }), HttpError);
  await expectHttp(409, "no agents (real)", () => ps.reassignOpenSubmissions(db, { dryRun: false }), HttpError);

  console.log("All team and reassignment DB tests passed!");
}
main().catch((e) => { console.error(e); process.exit(1); });
// FIXPASS END tests/pendingSubmissionsTeamDb.test.ts

