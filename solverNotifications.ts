// FIXPASS solverNotifications.ts
import { DbAdapter } from "./db";
import { HttpError } from "./httpError";
import { sendSms, SmsSendResult, HostPinnacleConfig } from "./hostPinnacle";
import { getHostPinnacleConfig } from "./integrationSettings";
import { getPendingSubmissionSettings, parseDbTimestamp } from "./pendingSubmissions";

export type SendFn = (config: HostPinnacleConfig, number: string, message: string) => Promise<SmsSendResult>;

export type NotifyTrigger = "auto" | "manual";

export interface NotifyResult {
  /** SENT, FAILED (a send was attempted or the integration is not ready), SKIPPED (nothing was done). */
  status: "SENT" | "FAILED" | "SKIPPED";
  message: string;
}

const STALE_SENDING_MS = 5 * 60 * 1000;

/** "Wed 14 Oct 2026, 10:30 AM" in Nairobi time. */
export function formatNairobiDateTime(value: unknown): string {
  const ms = parseDbTimestamp(value);
  if (isNaN(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("weekday")} ${g("day")} ${g("month")} ${g("year")}, ${g("hour")}:${g("minute")} ${g("dayPeriod").toUpperCase()}`;
}

/** Replaces {placeholders}. Unknown placeholders are left as they are (validation prevents them at save time). */
export function renderSolverSms(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, name) => (name in values ? values[name] : whole));
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * Sends the solver notification for a scheduled (GREEN) job.
 *
 * Concurrency: the job is CLAIMED with one conditional UPDATE (status -> SENDING) before the provider is
 * called. Only the request whose UPDATE affects a row may send. A claim older than 5 minutes is stale
 * and can be taken over. Attempts are counted at claim time, so a crash mid-send still counts.
 *
 * trigger "auto": only when no notification exists yet (status IS NULL).
 * trigger "manual": first send, retry after FAILED, or resend after SENT, up to 1 + solver_sms_max_resends sends.
 *
 * Throws HttpError for 404 and 409 conditions. Provider failures never throw: they return status FAILED.
 */
export async function notifySolver(
  db: DbAdapter,
  jobId: number,
  trigger: NotifyTrigger,
  sendFn: SendFn = sendSms,
  now: () => number = Date.now
): Promise<NotifyResult> {
  if (!Number.isInteger(jobId) || jobId <= 0) throw new HttpError(400, "Invalid record id.");

  const settings = await getPendingSubmissionSettings(db);
  if (trigger === "auto" && !settings.solver_sms_auto_send) {
    return { status: "SKIPPED", message: "Automatic solver SMS is turned off." };
  }
  const maxSends = 1 + settings.solver_sms_max_resends;

  const job = await db.queryOne<any>(
    `SELECT j.id, j.status, j.solver_name, j.solver_contact, j.vehicle_reg, j.vehicle_reg_raw, j.insurance_company,
            j.client_phone, j.client_phone_raw, j.scheduled_at, j.scheduled_place,
            j.solver_notification_status, j.solver_notification_attempts, a.name AS agent_name
     FROM pending_submission_jobs j
     LEFT JOIN agents a ON a.id = j.assigned_agent_id
     WHERE j.id = ?`,
    [jobId]
  );
  if (!job) throw new HttpError(404, "Record not found.");
  if (job.status !== "GREEN" || !job.scheduled_at || !job.scheduled_place) {
    throw new HttpError(409, "Only a scheduled job with a date and place can be sent to the solver.");
  }
  if (trigger === "auto" && job.solver_notification_status) {
    return { status: "SKIPPED", message: "A solver notification already exists for this job." };
  }
  if (Number(job.solver_notification_attempts) >= maxSends) {
    throw new HttpError(409, `The send limit of ${maxSends} messages for this job has been reached.`);
  }

  // Integration readiness. No provider call is made and no attempt is counted when it is not ready.
  const hp = await getHostPinnacleConfig(db);
  const notReady = !hp.enabled
    ? "Host Pinnacle is not enabled. Enable it under Settings, Integrations."
    : hp.config === null
    ? `Host Pinnacle is missing: ${hp.missing.join(", ")}.`
    : null;
  if (notReady) {
    if (trigger === "auto") {
      await db.execute(
        `UPDATE pending_submission_jobs SET solver_notification_status = 'FAILED', solver_notification_error = ?
         WHERE id = ? AND solver_notification_status IS NULL`,
        [notReady, jobId]
      );
    }
    return { status: "FAILED", message: notReady };
  }

  const solverNumber = String(job.solver_contact || "");
  if (solverNumber.replace(/\D/g, "").length < 9) {
    const msg = "The solver phone number on this job is not valid.";
    await db.execute(
      `UPDATE pending_submission_jobs SET solver_notification_status = 'FAILED', solver_notification_error = ? WHERE id = ? AND (solver_notification_status IS NULL OR solver_notification_status <> 'SENDING')`,
      [msg, jobId]
    );
    return { status: "FAILED", message: msg };
  }

  // Claim.
  const nowIso = new Date(now()).toISOString();
  const staleIso = new Date(now() - STALE_SENDING_MS).toISOString();
  const claimStates =
    trigger === "auto"
      ? "solver_notification_status IS NULL"
      : "(solver_notification_status IS NULL OR solver_notification_status IN ('FAILED','SENT') OR (solver_notification_status = 'SENDING' AND (solver_notification_attempted_at IS NULL OR solver_notification_attempted_at < ?)))";
  const claimParams: any[] = [nowIso, jobId];
  if (trigger === "manual") claimParams.push(staleIso);
  claimParams.push(maxSends);
  const claim = await db.execute(
    `UPDATE pending_submission_jobs
     SET solver_notification_status = 'SENDING',
         solver_notification_attempted_at = ?,
         solver_notification_attempts = solver_notification_attempts + 1,
         solver_notification_error = NULL
     WHERE id = ? AND status = 'GREEN' AND ${claimStates} AND solver_notification_attempts < ?`,
    claimParams
  );
  if (!claim.affectedRows) {
    throw new HttpError(409, "A message for this job is already being sent, or the send limit has been reached.");
  }

  // Send. Anything thrown from here must still end in a final state, never leave SENDING behind.
  const message = truncate(
    renderSolverSms(settings.solver_sms_template, {
      solver_name: job.solver_name || "Valuer",
      vehicle_reg: job.vehicle_reg_raw || job.vehicle_reg,
      scheduled_at: formatNairobiDateTime(job.scheduled_at),
      scheduled_place: job.scheduled_place,
      client_phone: job.client_phone_raw || `0${job.client_phone}`,
      agent_name: job.agent_name || "Solvit",
      insurance_company: job.insurance_company || "",
    }),
    480
  );

  let result: SmsSendResult;
  try {
    result = await sendFn(hp.config!, solverNumber, message);
  } catch (err) {
    console.error("[SolverSMS] Unexpected error while sending:", (err as Error)?.name);
    result = { ok: false, transactionId: null, error: "Unexpected error while sending.", deliveryUnknown: true };
  }

  if (result.ok) {
    await db.execute(
      `UPDATE pending_submission_jobs
       SET solver_notification_status = 'SENT', solver_notified_at = ?, solver_notification_error = NULL,
           solver_notification_message = ?, solver_notification_transaction_id = ?
       WHERE id = ? AND solver_notification_status = 'SENDING'`,
      [new Date(now()).toISOString(), message, result.transactionId, jobId]
    );
    return { status: "SENT", message: "Solver SMS sent." };
  }

  await db.execute(
    `UPDATE pending_submission_jobs
     SET solver_notification_status = 'FAILED', solver_notification_error = ?, solver_notification_message = ?
     WHERE id = ? AND solver_notification_status = 'SENDING'`,
    [truncate(result.error || "Send failed.", 500), message, jobId]
  );
  return { status: "FAILED", message: result.error || "Send failed." };
}
// FIXPASS END solverNotifications.ts

