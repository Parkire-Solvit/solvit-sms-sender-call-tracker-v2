import crypto from "node:crypto";
import { DbAdapter } from "./db";
import {
  getCallbackSettings,
  getValidCallbackAgentIds,
  computeCallbackJobsActivity,
  hasReachedMaxAttempts,
} from "./insuranceCallbacks";

export const CLOSURE_REOPEN_JOB_KEY = "closure_rule_reopen_v1";

export type ClosureReopenAction =
  | "COMPLIANT"
  | "REOPENED"
  | "ASSIGNED_AND_REOPENED"
  | "SKIPPED_NO_ALLOCATION";

export interface ClosureReopenJobInput {
  id: number;
  vehicle_reg: string;
  vehicle_reg_raw?: string;
  client_name?: string | null;
  client_phone?: string;
  client_phone_raw?: string;
  channel_partner: string | null;
  assigned_agent_id: number | null;
  status: string;
  latest_outcome: string | null;
  closed_at: string | null;
}

export interface ClosureReopenDecision {
  job: ClosureReopenJobInput;
  action: ClosureReopenAction;
  previous_status: string;
  previous_closed_at: string | null;
  previous_latest_outcome: string | null;
  previous_assigned_agent_id: number | null;
  new_assigned_agent_id: number | null;
  outgoing_calls: number;
  sms_count: number;
}

/**
 * Pure function: plans closure reopen decisions for each job.
 * Deterministic and free of side effects for unit testing.
 *
 * Decision table:
 * a) Job has a valid assigned agent and hasReachedMaxAttempts is true: leave untouched (count as compliant).
 * b) Job has a valid assigned agent and hasReachedMaxAttempts is false: action REOPENED.
 * c) Job has no valid assigned agent (NULL, deleted, archived or not on the callback team),
 *    and its channel partner has an allocation to a valid agent:
 *    evaluate the rule as if the job were assigned to that allocated agent.
 *    If the rule is met: leave untouched and count as compliant.
 *    If not met: action ASSIGNED_AND_REOPENED.
 * d) Job has no valid assigned agent and no usable allocation:
 *    leave closed and unassigned, action SKIPPED_NO_ALLOCATION.
 */
export function planClosureReopen(
  jobs: ClosureReopenJobInput[],
  activityByJobId: Map<number, { attempt_count: number; sms_count: number }>,
  allocations: Map<string, { assigned_agent_id: number | null; assigned_agent_name?: string | null }>,
  validAgentIds: Set<number>,
  settings: { max_attempts: number; max_sms_attempts: number }
): ClosureReopenDecision[] {
  const decisions: ClosureReopenDecision[] = [];

  for (const job of jobs) {
    const act = activityByJobId.get(job.id) || { attempt_count: 0, sms_count: 0 };
    const hasValidAssignedAgent =
      job.assigned_agent_id !== null &&
      job.assigned_agent_id !== undefined &&
      validAgentIds.has(job.assigned_agent_id);

    if (hasValidAssignedAgent) {
      if (hasReachedMaxAttempts(act, settings)) {
        decisions.push({
          job,
          action: "COMPLIANT",
          previous_status: job.status,
          previous_closed_at: job.closed_at,
          previous_latest_outcome: job.latest_outcome,
          previous_assigned_agent_id: job.assigned_agent_id,
          new_assigned_agent_id: job.assigned_agent_id,
          outgoing_calls: act.attempt_count,
          sms_count: act.sms_count,
        });
      } else {
        decisions.push({
          job,
          action: "REOPENED",
          previous_status: job.status,
          previous_closed_at: job.closed_at,
          previous_latest_outcome: job.latest_outcome,
          previous_assigned_agent_id: job.assigned_agent_id,
          new_assigned_agent_id: job.assigned_agent_id,
          outgoing_calls: act.attempt_count,
          sms_count: act.sms_count,
        });
      }
    } else {
      const partnerKey = (job.channel_partner || "").trim().toLowerCase();
      const alloc = allocations.get(partnerKey);
      const allocatedAgentId = alloc?.assigned_agent_id ?? null;
      const hasValidAllocatedAgent =
        allocatedAgentId !== null &&
        allocatedAgentId !== undefined &&
        validAgentIds.has(allocatedAgentId);

      if (hasValidAllocatedAgent) {
        if (hasReachedMaxAttempts(act, settings)) {
          decisions.push({
            job,
            action: "COMPLIANT",
            previous_status: job.status,
            previous_closed_at: job.closed_at,
            previous_latest_outcome: job.latest_outcome,
            previous_assigned_agent_id: job.assigned_agent_id,
            new_assigned_agent_id: allocatedAgentId,
            outgoing_calls: act.attempt_count,
            sms_count: act.sms_count,
          });
        } else {
          decisions.push({
            job,
            action: "ASSIGNED_AND_REOPENED",
            previous_status: job.status,
            previous_closed_at: job.closed_at,
            previous_latest_outcome: job.latest_outcome,
            previous_assigned_agent_id: job.assigned_agent_id,
            new_assigned_agent_id: allocatedAgentId,
            outgoing_calls: act.attempt_count,
            sms_count: act.sms_count,
          });
        }
      } else {
        decisions.push({
          job,
          action: "SKIPPED_NO_ALLOCATION",
          previous_status: job.status,
          previous_closed_at: job.closed_at,
          previous_latest_outcome: job.latest_outcome,
          previous_assigned_agent_id: job.assigned_agent_id,
          new_assigned_agent_id: null,
          outgoing_calls: act.attempt_count,
          sms_count: act.sms_count,
        });
      }
    }
  }

  return decisions;
}

/**
 * Execute the one-time closure reopen job.
 * Runs once at server startup after HTTP listen, never delays startup or crashes server.
 */
export async function runOneTimeClosureReopen(db: DbAdapter): Promise<void> {
  try {
    // 1. If a row with this job_key already exists in one_time_job_runs, return immediately.
    const existing = await db.queryOne<{ id: number }>(
      `SELECT id FROM one_time_job_runs WHERE job_key = ?`,
      [CLOSURE_REOPEN_JOB_KEY]
    );
    if (existing) {
      console.log(`[One-Time Reopen] Job '${CLOSURE_REOPEN_JOB_KEY}' already executed. Skipping.`);
      return;
    }

    console.log(`[One-Time Reopen] Starting one-time closure reopen evaluation (${CLOSURE_REOPEN_JOB_KEY})...`);

    // 2. Load settings and channel partner allocations
    const settings = await getCallbackSettings(db);
    const validAgentIds = await getValidCallbackAgentIds(db, settings.callback_team_tag);

    const allocationsRows = await db.queryAll<{
      channel_partner: string;
      assigned_agent_id: number | null;
      assigned_agent_name: string | null;
    }>(
      `SELECT cpa.channel_partner, cpa.assigned_agent_id, a.name AS assigned_agent_name
       FROM channel_partner_allocations cpa
       LEFT JOIN agents a ON a.id = cpa.assigned_agent_id`
    );
    const allocations = new Map<string, { assigned_agent_id: number | null; assigned_agent_name: string | null }>();
    for (const alloc of allocationsRows) {
      if (alloc.channel_partner) {
        allocations.set(alloc.channel_partner.trim().toLowerCase(), {
          assigned_agent_id: alloc.assigned_agent_id ?? null,
          assigned_agent_name: alloc.assigned_agent_name ?? null,
        });
      }
    }

    // 3. Load every job where status = 'RED' AND latest_outcome = 'MAX_ATTEMPTS_REACHED'
    const jobs = await db.queryAll<ClosureReopenJobInput>(
      `SELECT id, vehicle_reg, vehicle_reg_raw, client_name, client_phone, client_phone_raw, channel_partner, assigned_agent_id, status, latest_outcome, closed_at
       FROM callback_jobs
       WHERE status = 'RED' AND latest_outcome = 'MAX_ATTEMPTS_REACHED'
       ORDER BY id ASC`
    );

    if (jobs.length === 0) {
      console.log(`[One-Time Reopen] No closed MAX_ATTEMPTS_REACHED jobs found. Marking run complete.`);
      const runToken = crypto.randomUUID();
      const summaryStr = JSON.stringify({
        candidates: 0,
        compliant_left_closed: 0,
        reopened: 0,
        assigned_and_reopened: 0,
        skipped_no_allocation: 0,
      });
      await db.execute(
        `INSERT INTO one_time_job_runs (job_key, run_token, summary) VALUES (?, ?, ?) ON CONFLICT (job_key) DO NOTHING`,
        [CLOSURE_REOPEN_JOB_KEY, runToken, summaryStr]
      );
      return;
    }

    // Pass copy of job with assigned_agent_id set to allocated agent for unassigned jobs
    const jobsForActivity = jobs.map((job) => {
      const hasValidAssignedAgent =
        job.assigned_agent_id !== null &&
        job.assigned_agent_id !== undefined &&
        validAgentIds.has(job.assigned_agent_id);

      if (hasValidAssignedAgent) {
        return job;
      }

      const partnerKey = (job.channel_partner || "").trim().toLowerCase();
      const alloc = allocations.get(partnerKey);
      const allocatedAgentId = alloc?.assigned_agent_id ?? null;
      if (allocatedAgentId !== null && allocatedAgentId !== undefined && validAgentIds.has(allocatedAgentId)) {
        return { ...job, assigned_agent_id: allocatedAgentId };
      }
      return job;
    });

    const activityByJobId = await computeCallbackJobsActivity(db, jobsForActivity);

    // 4. Build pure plan
    const decisions = planClosureReopen(jobs, activityByJobId, allocations, validAgentIds, settings);

    const compliantCount = decisions.filter((d) => d.action === "COMPLIANT").length;
    let actualReopenedCount = 0;
    let actualAssignedAndReopenedCount = 0;
    let actualSkippedNoAllocationCount = 0;

    // 5. Apply all decisions inside ONE db.transaction
    await db.transaction(async (tx) => {
      const runToken = crypto.randomUUID();

      // First, claim the run: insert with run_token, then select back
      await tx.execute(
        `INSERT INTO one_time_job_runs (job_key, run_token) VALUES (?, ?) ON CONFLICT (job_key) DO NOTHING`,
        [CLOSURE_REOPEN_JOB_KEY, runToken]
      );

      const claimedRow = await tx.queryOne<{ run_token: string }>(
        `SELECT run_token FROM one_time_job_runs WHERE job_key = ?`,
        [CLOSURE_REOPEN_JOB_KEY]
      );

      if (!claimedRow || claimedRow.run_token !== runToken) {
        console.log(`[One-Time Reopen] Job '${CLOSURE_REOPEN_JOB_KEY}' already claimed by another process. Aborting.`);
        return;
      }

      const baseLogComment =
        "Reopened automatically: closed under the old rule and does not meet the minimum outgoing calls and SMS.";

      for (const dec of decisions) {
        if (dec.action === "REOPENED" || dec.action === "ASSIGNED_AND_REOPENED") {
          // Re-check inside the transaction that it is still status 'RED' and latest_outcome 'MAX_ATTEMPTS_REACHED'
          const currentJob = await tx.queryOne<{ id: number; status: string; latest_outcome: string | null }>(
            `SELECT id, status, latest_outcome FROM callback_jobs WHERE id = ?`,
            [dec.job.id]
          );

          if (!currentJob || currentJob.status !== "RED" || currentJob.latest_outcome !== "MAX_ATTEMPTS_REACHED") {
            // Skipped for this reason: no snapshot row and no log row
            continue;
          }

          // Insert snapshot row
          await tx.execute(
            `INSERT INTO callback_reopen_snapshot (
              job_key, callback_job_id, action,
              previous_status, previous_closed_at, previous_latest_outcome,
              previous_assigned_agent_id, new_assigned_agent_id,
              outgoing_calls, sms_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              CLOSURE_REOPEN_JOB_KEY,
              dec.job.id,
              dec.action,
              dec.previous_status,
              dec.previous_closed_at,
              dec.previous_latest_outcome,
              dec.previous_assigned_agent_id,
              dec.new_assigned_agent_id,
              dec.outgoing_calls,
              dec.sms_count,
            ]
          );

          if (dec.action === "REOPENED") {
            await tx.execute(
              `UPDATE callback_jobs 
               SET status = 'AMBER', closed_at = NULL, latest_outcome = NULL, assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [dec.new_assigned_agent_id, dec.job.id]
            );

            await tx.execute(
              `INSERT INTO callback_job_logs (
                callback_job_id, outcome, comment, logged_by, resulting_status, created_at
              ) VALUES (?, 'REOPENED', ?, 'System', 'AMBER', CURRENT_TIMESTAMP)`,
              [dec.job.id, baseLogComment]
            );
            actualReopenedCount++;
          } else {
            // ASSIGNED_AND_REOPENED
            await tx.execute(
              `UPDATE callback_jobs 
               SET status = 'AMBER', closed_at = NULL, latest_outcome = NULL, assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [dec.new_assigned_agent_id, dec.job.id]
            );

            const assignedComment =
              baseLogComment + " Assigned to the channel partner allocated agent.";

            await tx.execute(
              `INSERT INTO callback_job_logs (
                callback_job_id, outcome, comment, logged_by, resulting_status, created_at
              ) VALUES (?, 'REOPENED', ?, 'System', 'AMBER', CURRENT_TIMESTAMP)`,
              [dec.job.id, assignedComment]
            );
            actualAssignedAndReopenedCount++;
          }
        } else if (dec.action === "SKIPPED_NO_ALLOCATION") {
          // Insert snapshot row for SKIPPED_NO_ALLOCATION, leave job untouched
          await tx.execute(
            `INSERT INTO callback_reopen_snapshot (
              job_key, callback_job_id, action,
              previous_status, previous_closed_at, previous_latest_outcome,
              previous_assigned_agent_id, new_assigned_agent_id,
              outgoing_calls, sms_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              CLOSURE_REOPEN_JOB_KEY,
              dec.job.id,
              dec.action,
              dec.previous_status,
              dec.previous_closed_at,
              dec.previous_latest_outcome,
              dec.previous_assigned_agent_id,
              null,
              dec.outgoing_calls,
              dec.sms_count,
            ]
          );
          actualSkippedNoAllocationCount++;
        }
      }

      const summaryObj = {
        candidates: decisions.length,
        compliant_left_closed: compliantCount,
        reopened: actualReopenedCount,
        assigned_and_reopened: actualAssignedAndReopenedCount,
        skipped_no_allocation: actualSkippedNoAllocationCount,
      };
      const summaryStr = JSON.stringify(summaryObj);

      await tx.execute(
        `UPDATE one_time_job_runs SET summary = ?, completed_at = CURRENT_TIMESTAMP WHERE job_key = ?`,
        [summaryStr, CLOSURE_REOPEN_JOB_KEY]
      );
    });

    console.log(
      `[One-Time Reopen] Completed ${CLOSURE_REOPEN_JOB_KEY}. Considered: ${decisions.length}, Compliant: ${compliantCount}, Reopened: ${actualReopenedCount}, Assigned and Reopened: ${actualAssignedAndReopenedCount}, Skipped: ${actualSkippedNoAllocationCount}`
    );
  } catch (err) {
    console.error("[One-Time Reopen] Failed to execute one-time closure reopen:", err);
  }
}
