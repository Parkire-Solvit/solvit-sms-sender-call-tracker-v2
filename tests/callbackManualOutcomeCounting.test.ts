import assert from "node:assert/strict";
import test from "node:test";
import { computeCallbackJobsActivity } from "../insuranceCallbacks";

test("manual outcomes update call attempts without double-counting synced phone events", async () => {
  const db = {
    async queryOne(sql: string) {
      if (sql.includes("FROM callback_settings")) {
        return {
          id: 1,
          staff_count: 1,
          callback_team_tag: "Callback Team",
          max_attempts: 4,
          max_sms_attempts: 4,
          disappearance_alert_fixed_count: 50,
          disappearance_alert_percentage: 30,
          updated_at: null,
        };
      }
      return null;
    },
    async queryAll(sql: string) {
      if (sql.includes("FROM agents")) return [{ id: 7, name: "Carol" }];
      if (sql.includes("FROM events")) {
        return [{
          id: 10,
          target_phone: "0714820803",
          type: "CALL",
          status: "OUTGOING",
          reg_no: null,
          timestamp: "2026-10-27T08:00:00.000Z",
          agent_id: 7,
        }];
      }
      if (sql.includes("FROM callback_job_phones")) {
        return [{ callback_job_id: "1", phone_normalised: "714820803" }];
      }
      if (sql.includes("FROM callback_job_logs")) {
        assert.match(sql, /logged_by/);
        return [{
          callback_job_id: "1",
          attempt_count: 9,
          last_attempt_at: "2026-10-27T09:00:00.000Z",
        }];
      }
      return [];
    },
    async execute() {
      return { lastInsertId: 0, affectedRows: 0 };
    },
    async transaction(work: (tx: unknown) => Promise<unknown>) {
      return work(this);
    },
  } as any;

  const result = await computeCallbackJobsActivity(db, [{
    id: "1" as any,
    assigned_agent_id: 7,
    vehicle_reg: "KCU380Y",
    client_phone: "0714820803",
  }]);

  assert.equal(result.get("1" as any)?.attempt_count, 9);
  assert.equal(result.get("1" as any)?.last_attempt_at, "2026-10-27T09:00:00.000Z");
});

