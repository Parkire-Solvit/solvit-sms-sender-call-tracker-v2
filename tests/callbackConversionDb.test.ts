// tests/callbackConversionDb.test.ts
// Pending Scheduling (Callbacks): the Agent conversion rate counts callbacks an agent closed GREEN and leaves out
// callbacks closed because an upload no longer contained them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    console.log("Skipping callback conversion DB integration test: TEST_DATABASE_URL is not configured.");
    return;
  }
  const root = process.cwd();
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "cb-conv-test-")));
  const { initDatabase } = await import(pathToFileURL(path.join(root, "db.ts")).href);
  const kpi = await import(pathToFileURL(path.join(root, "agentKpiService.ts")).href);
  const db = await initDatabase();

  console.log("Running DB integration tests for the Pending Scheduling agent conversion rate...");

  await db.execute("INSERT INTO agents (name, tag) VALUES ('Dana', 'Callback Team')");
  const dana = Number((await db.queryOne("SELECT id FROM agents WHERE name = 'Dana'")).id);
  const nowIso = new Date().toISOString();
  const add = (reg: string, status: string, outcome: string | null) =>
    db.execute(
      `INSERT INTO callback_jobs (vehicle_reg, vehicle_reg_raw, client_name, client_phone, client_phone_raw, channel_partner, initiated_date, status, assigned_agent_id, latest_outcome, closed_at)
       VALUES (?, ?, 'Client', '722000001', '722000001', 'Partner', '2026-11-01', ?, ?, ?, ?)`,
      [reg, reg, status, dana, outcome, status === "AMBER" ? null : nowIso]
    );
  await add("KCA001A", "GREEN", "SCHEDULED");
  await add("KCA002A", "GREEN", "ABSENT_FROM_LATEST_EXPORT"); // closed by upload: not a conversion
  await add("KCA003A", "RED", "MAX_ATTEMPTS_REACHED");
  await add("KCA004A", "AMBER", null);

  const report = await kpi.getCallbackAgentKpis(db);
  assert(report.conversion.green === 1 && report.conversion.total === 4, `overall: 1 of 4 (got ${JSON.stringify(report.conversion)})`);
  assert(report.conversion.rate === 25, "overall rate 25%");
  const row = report.agents.find((a: any) => a.agent_id === dana);
  assert(row.conversion.green === 1 && row.conversion.total === 4, "per agent: 1 of 4");

  console.log("All Pending Scheduling conversion DB tests passed!");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
