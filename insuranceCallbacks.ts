import { DbAdapter } from "./db";
import { 
  CallbackJob, 
  CallbackSettings, 
  CallbackImportSummary, 
  CallbackImportPayload,
  CallbackJobStatus,
  MaxAttemptsReportGroup,
  MaxAttemptsReportRecord,
  MaxAttemptsReportAttempt,
  CallbackJobLog
} from "./src/types/callbacks";

const VALID_AGENT_OUTCOMES = new Set<string>([
  "SCHEDULED",
  "DECLINED",
  "VALUED_ELSEWHERE",
  "NOT_PICKING",
  "WRONG_NUMBER",
  "NOT_READY",
  "UNREACHABLE",
]);

/**
 * Normalization Rules:
 * Phone number:
 *   - Strip every character except digits.
 *   - Take the last 9 digits as canonical value.
 *   - Unifies 0722123456, 722123456, and 254722123456 into 722123456.
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/**
 * Vehicle registration:
 *   - Uppercase.
 *   - Strip all whitespace.
 */
export function normalizeVehicleReg(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).toUpperCase().replace(/\s+/g, "");
}

/**
 * Fetch callback settings or initialize defaults
 */
export async function getCallbackSettings(db: DbAdapter): Promise<CallbackSettings> {
  const row = await db.queryOne<CallbackSettings>(
    `SELECT id, staff_count, callback_team_tag, max_attempts, updated_at FROM callback_settings WHERE id = 1`
  );

  let teamTag = "Callback Team";
  let maxAttempts = 4;

  if (row) {
    teamTag = String(row.callback_team_tag || "Callback Team").trim();
    // Automatically migrate legacy 'Insurance Callback Team' to 'Callback Team'
    if (teamTag === "Insurance Callback Team") {
      teamTag = "Callback Team";
      try {
        await db.execute(`UPDATE callback_settings SET callback_team_tag = 'Callback Team' WHERE id = 1`);
        await db.execute(`UPDATE agents SET tag = 'Callback Team' WHERE tag = 'Insurance Callback Team'`);
      } catch (_) {}
    }
    maxAttempts = Number(row.max_attempts || 4);
  } else {
    // Insert default if row 1 is missing
    await db.execute(
      `INSERT INTO callback_settings (id, staff_count, callback_team_tag, max_attempts) VALUES (1, 0, 'Callback Team', 4) ON CONFLICT (id) DO NOTHING`
    );
  }

  // Ensure baseline agents Caroline and Mercy exist if no agents exist with this tag yet
  const taggedAgentsCheck = await db.queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM agents WHERE tag = ? AND (archived_at IS NULL) ORDER BY name ASC`,
    [teamTag]
  );

  if (taggedAgentsCheck.length === 0 && teamTag === "Callback Team") {
    try {
      await db.execute(`INSERT INTO agents (name, tag) VALUES ('Caroline', 'Callback Team') ON CONFLICT (name) DO NOTHING`);
      await db.execute(`INSERT INTO agents (name, tag) VALUES ('Mercy', 'Callback Team') ON CONFLICT (name) DO NOTHING`);
    } catch (_) {}
  }

  // Fetch all active agents currently having callback_team_tag
  const activeAgents = await db.queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM agents WHERE tag = ? AND (archived_at IS NULL) ORDER BY id ASC`,
    [teamTag]
  );

  const autoStaffCount = activeAgents.length;

  // Auto-assign / sync staff_count in database table
  await db.execute(
    `UPDATE callback_settings SET staff_count = ?, callback_team_tag = ? WHERE id = 1`,
    [autoStaffCount, teamTag]
  );

  return {
    id: 1,
    staff_count: autoStaffCount,
    callback_team_tag: teamTag,
    max_attempts: maxAttempts,
    active_agents: activeAgents,
    updated_at: row?.updated_at,
  };
}

/**
 * Update callback settings
 */
export async function updateCallbackSettings(
  db: DbAdapter,
  updates: Partial<Pick<CallbackSettings, "staff_count" | "callback_team_tag" | "max_attempts">>
): Promise<CallbackSettings> {
  const current = await getCallbackSettings(db);

  const teamTag = updates.callback_team_tag !== undefined ? String(updates.callback_team_tag).trim() : current.callback_team_tag;
  const maxAttempts = updates.max_attempts !== undefined ? Number(updates.max_attempts) : current.max_attempts;

  // Count active agents who have this tag
  const activeAgents = await db.queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM agents WHERE tag = ? AND (archived_at IS NULL) ORDER BY id ASC`,
    [teamTag]
  );
  const autoStaffCount = activeAgents.length;

  await db.execute(
    `UPDATE callback_settings SET staff_count = ?, callback_team_tag = ?, max_attempts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    [autoStaffCount, teamTag, maxAttempts]
  );

  return {
    id: 1,
    staff_count: autoStaffCount,
    callback_team_tag: teamTag,
    max_attempts: maxAttempts,
    active_agents: activeAgents,
  };
}

/**
 * Import callback jobs from parsed Excel rows
 */
export async function importCallbackJobs(
  db: DbAdapter,
  payload: CallbackImportPayload
): Promise<CallbackImportSummary> {
  const rows = payload.rows || [];
  const fileName = payload.file_name || "import.xlsx";
  const importedBy = payload.imported_by || "Caroline";

  let newRecordsCount = 0;
  let skippedOpenCount = 0;
  let skippedClosedCount = 0;

  const newlyInsertedJobs: { id: number; client_phone: string }[] = [];

  for (const row of rows) {
    const rawReg = String(row.vehicle_reg || "").trim();
    const rawPhone = String(row.client_phone || "").trim();
    const clientName = row.client_name ? String(row.client_name).trim() : null;
    const channelPartner = row.channel_partner ? String(row.channel_partner).trim() : null;
    const initiatedDate = row.initiated_date ? String(row.initiated_date).trim() : null;
    const brianReason = row.reason ? String(row.reason).trim() : null;

    const normReg = normalizeVehicleReg(rawReg);
    const normPhone = normalizePhone(rawPhone);

    if (!normReg || !normPhone) {
      continue;
    }

    // Check if a callback_jobs row with this vehicle_reg already exists
    const existing = await db.queryOne<{ id: number; status: string }>(
      `SELECT id, status FROM callback_jobs WHERE vehicle_reg = ?`,
      [normReg]
    );

    if (existing) {
      if (existing.status === "GREEN" || existing.status === "RED") {
        // Skip entirely. Do not update anything, including last_seen_in_import_at.
        skippedClosedCount++;
      } else {
        // Still AMBER: update only last_seen_in_import_at to now. Do not touch status, assigned_agent_id, or any other field.
        await db.execute(
          `UPDATE callback_jobs SET last_seen_in_import_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [existing.id]
        );
        skippedOpenCount++;
      }
    } else {
      // Insert new row at status = 'AMBER'
      const insertResult = await db.execute(
        `INSERT INTO callback_jobs (
          vehicle_reg, vehicle_reg_raw, client_name, client_phone, client_phone_raw,
          channel_partner, initiated_date, brian_reason, status,
          first_imported_at, last_seen_in_import_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          normReg,
          rawReg,
          clientName,
          normPhone,
          rawPhone,
          channelPartner,
          initiatedDate,
          brianReason,
        ]
      );

      const newId = insertResult.lastInsertId;
      newRecordsCount++;
      newlyInsertedJobs.push({ id: newId, client_phone: normPhone });
    }
  }

  // Assignment balancing across newly inserted rows in this batch
  if (newlyInsertedJobs.length > 0) {
    const settings = await getCallbackSettings(db);

    // Load ALL active callback-team agents: agents WHERE tag = callback_team_tag AND archived_at IS NULL
    const activeAgents = await db.queryAll<{ id: number; name: string }>(
      `SELECT id, name FROM agents WHERE tag = ? AND (archived_at IS NULL) ORDER BY id ASC`,
      [settings.callback_team_tag]
    );

    if (activeAgents.length > 0) {
      // Count current open (status = 'AMBER') vehicles for each agent
      const agentOpenCounts: Record<number, number> = {};
      for (const agent of activeAgents) {
        const countRow = await db.queryOne<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM callback_jobs WHERE status = 'AMBER' AND assigned_agent_id = ?`,
          [agent.id]
        );
        agentOpenCounts[agent.id] = Number(countRow?.cnt || 0);
      }

      // Group new rows by normalized client_phone
      const clientGroups = new Map<string, number[]>();
      for (const job of newlyInsertedJobs) {
        const group = clientGroups.get(job.client_phone) || [];
        group.push(job.id);
        clientGroups.set(job.client_phone, group);
      }

      // Assign each client group to agent with fewest open vehicles
      for (const [, jobIds] of clientGroups.entries()) {
        let selectedAgent = activeAgents[0];
        let minOpen = agentOpenCounts[selectedAgent.id];

        for (let i = 1; i < activeAgents.length; i++) {
          const cand = activeAgents[i];
          if (agentOpenCounts[cand.id] < minOpen) {
            minOpen = agentOpenCounts[cand.id];
            selectedAgent = cand;
          }
        }

        for (const jobId of jobIds) {
          await db.execute(
            `UPDATE callback_jobs SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [selectedAgent.id, jobId]
          );
        }

        // Increment running count by the number of vehicles just assigned
        agentOpenCounts[selectedAgent.id] += jobIds.length;
      }
    }
  }

  // Disappearance check:
  // 1. Build the set of normalized vehicle_reg values present in this upload's rows
  const uploadRegs = new Set(
    rows.map((r) => normalizeVehicleReg(r.vehicle_reg)).filter(Boolean)
  );

  let autoClosedAbsentCount = 0;

  // 2. Query all currently AMBER callback_jobs rows
  if (uploadRegs.size > 0) {
    const openJobs = await db.queryAll<{ id: number; vehicle_reg: string }>(
      `SELECT id, vehicle_reg FROM callback_jobs WHERE status = 'AMBER'`
    );

    // 3. For any whose vehicle_reg is not in that set: set status = 'GREEN', closed_at = now(),
    // latest_outcome = 'ABSENT_FROM_LATEST_EXPORT', and insert callback_job_logs row
    for (const job of openJobs) {
      if (!uploadRegs.has(job.vehicle_reg)) {
        await db.execute(
          `UPDATE callback_jobs 
           SET status = 'GREEN', closed_at = CURRENT_TIMESTAMP, latest_outcome = 'ABSENT_FROM_LATEST_EXPORT', updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [job.id]
        );
        await db.execute(
          `INSERT INTO callback_job_logs (
            callback_job_id, outcome, comment, logged_by, resulting_status, created_at
          ) VALUES (?, 'ABSENT_FROM_LATEST_EXPORT', 'Vehicle no longer present in Brian''s latest export; assumed scheduled.', 'System', 'GREEN', CURRENT_TIMESTAMP)`,
          [job.id]
        );
        autoClosedAbsentCount++;
      }
    }
  }

  // Insert callback_imports record
  await db.execute(
    `INSERT INTO callback_imports (
      file_name, imported_by, row_count_total, new_records_count, skipped_open_count, skipped_closed_count, auto_closed_absent_count, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      fileName,
      importedBy,
      rows.length,
      newRecordsCount,
      skippedOpenCount,
      skippedClosedCount,
      autoClosedAbsentCount,
    ]
  );

  // Full sweep of matured callback jobs
  await closeMaturedCallbackJobs(db);

  return {
    row_count_total: rows.length,
    new_records_count: newRecordsCount,
    skipped_open_count: skippedOpenCount,
    skipped_closed_count: skippedClosedCount,
    auto_closed_absent_count: autoClosedAbsentCount,
  };
}

/**
 * Close any AMBER jobs whose attempts have reached or exceeded callback_settings.max_attempts
 */
export async function closeMaturedCallbackJobs(db: DbAdapter, jobId?: number): Promise<void> {
  const settings = await getCallbackSettings(db);
  const maxAttempts = settings.max_attempts;

  let query = `SELECT id, client_phone FROM callback_jobs WHERE status = 'AMBER'`;
  const params: any[] = [];
  if (jobId !== undefined && jobId !== null) {
    query += ` AND id = ?`;
    params.push(jobId);
  }

  const openJobs = await db.queryAll<{ id: number; client_phone: string }>(query, params);
  if (openJobs.length === 0) return;

  // Query events scoped to agents.tag = settings.callback_team_tag AND archived_at IS NULL
  const events = await db.queryAll<{ target_phone: string; type: string }>(
    `SELECT e.target_phone, e.type
     FROM events e
     JOIN agents a ON e.agent_id = a.id
     WHERE a.tag = ? AND (a.archived_at IS NULL) AND e.type = 'CALL'`,
    [settings.callback_team_tag]
  );

  const phoneAttemptMap = new Map<string, number>();
  for (const ev of events) {
    const normP = normalizePhone(ev.target_phone);
    if (!normP) continue;
    phoneAttemptMap.set(normP, (phoneAttemptMap.get(normP) || 0) + 1);
  }

  for (const job of openJobs) {
    const attempts = phoneAttemptMap.get(job.client_phone) || 0;
    if (attempts >= maxAttempts) {
      await db.execute(
        `UPDATE callback_jobs 
         SET status = 'RED', closed_at = CURRENT_TIMESTAMP, latest_outcome = 'MAX_ATTEMPTS_REACHED', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [job.id]
      );
      await db.execute(
        `INSERT INTO callback_job_logs (
          callback_job_id, outcome, comment, logged_by, resulting_status, created_at
        ) VALUES (?, 'MAX_ATTEMPTS_REACHED', 'Automatically closed: maximum contact attempts reached.', 'System', 'RED', CURRENT_TIMESTAMP)`,
        [job.id]
      );
    }
  }
}

/**
 * Log outcome for a callback job
 */
export async function logCallbackOutcome(
  db: DbAdapter,
  jobId: number,
  outcome: string,
  comment: string,
  loggedBy: string
): Promise<CallbackJob> {
  const cleanOutcome = String(outcome || "").trim().toUpperCase();
  const cleanComment = String(comment || "").trim();
  const cleanLoggedBy = String(loggedBy || "").trim() || "Agent";

  if (!VALID_AGENT_OUTCOMES.has(cleanOutcome)) {
    throw new Error(`Invalid outcome '${outcome}'. Allowed values: ${Array.from(VALID_AGENT_OUTCOMES).join(", ")}`);
  }

  if (!cleanComment) {
    throw new Error("Comment is required for logging a callback outcome.");
  }

  let resultingStatus: CallbackJobStatus = "AMBER";
  if (cleanOutcome === "SCHEDULED") {
    resultingStatus = "GREEN";
  } else if (cleanOutcome === "DECLINED" || cleanOutcome === "VALUED_ELSEWHERE") {
    resultingStatus = "RED";
  } else {
    // NOT_PICKING, WRONG_NUMBER, NOT_READY, UNREACHABLE
    resultingStatus = "AMBER";
  }

  // Insert callback_job_logs
  await db.execute(
    `INSERT INTO callback_job_logs (
      callback_job_id, outcome, comment, logged_by, resulting_status, created_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [jobId, cleanOutcome, cleanComment, cleanLoggedBy, resultingStatus]
  );

  // Update callback_jobs
  if (resultingStatus === "GREEN" || resultingStatus === "RED") {
    await db.execute(
      `UPDATE callback_jobs 
       SET status = ?, latest_outcome = ?, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [resultingStatus, cleanOutcome, jobId]
    );
  } else {
    // If AMBER, leave closed_at untouched
    await db.execute(
      `UPDATE callback_jobs 
       SET status = 'AMBER', latest_outcome = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [cleanOutcome, jobId]
    );
  }

  // Call closeMaturedCallbackJobs scoped to this one job immediately afterward
  await closeMaturedCallbackJobs(db, jobId);

  // Return updated job
  const jobs = await getCallbackJobs(db, {});
  const updatedJob = jobs.find((j) => j.id === Number(jobId));
  if (!updatedJob) {
    throw new Error(`Callback job with ID ${jobId} not found.`);
  }
  return updatedJob;
}

/**
 * Fetch all logs for a single callback job
 */
export async function getCallbackJobLogs(
  db: DbAdapter,
  jobId: number
): Promise<CallbackJobLog[]> {
  return db.queryAll<CallbackJobLog>(
    `SELECT id, callback_job_id, outcome, comment, logged_by, resulting_status, created_at
     FROM callback_job_logs
     WHERE callback_job_id = ?
     ORDER BY created_at ASC`,
    [jobId]
  );
}

/**
 * Fetch callback jobs with computed activity metrics
 */
export async function getCallbackJobs(
  db: DbAdapter,
  filters: {
    status?: string;
    channel_partner?: string;
    assigned_agent_id?: string | number;
    search?: string;
  }
): Promise<CallbackJob[]> {
  // Call closeMaturedCallbackJobs first so the list is always fresh
  await closeMaturedCallbackJobs(db);

  const settings = await getCallbackSettings(db);

  let query = `
    SELECT 
      j.id,
      j.vehicle_reg,
      j.vehicle_reg_raw,
      j.client_name,
      j.client_phone,
      j.client_phone_raw,
      j.channel_partner,
      j.initiated_date,
      j.brian_reason,
      j.status,
      j.assigned_agent_id,
      a.name as assigned_agent_name,
      j.latest_outcome,
      j.first_imported_at,
      j.last_seen_in_import_at,
      j.closed_at,
      j.created_at,
      j.updated_at
    FROM callback_jobs j
    LEFT JOIN agents a ON j.assigned_agent_id = a.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.status && filters.status !== "ALL") {
    query += ` AND j.status = ?`;
    params.push(filters.status.toUpperCase());
  }

  if (filters.channel_partner && filters.channel_partner !== "ALL") {
    query += ` AND j.channel_partner = ?`;
    params.push(filters.channel_partner);
  }

  if (filters.assigned_agent_id && filters.assigned_agent_id !== "ALL") {
    const rawVal = String(filters.assigned_agent_id).trim();
    if (/^\d+$/.test(rawVal)) {
      query += ` AND j.assigned_agent_id = ?`;
      params.push(Number(rawVal));
    } else {
      query += ` AND (LOWER(a.name) = LOWER(?) OR j.assigned_agent_id IN (SELECT id FROM agents WHERE LOWER(name) = LOWER(?)))`;
      params.push(rawVal, rawVal);
    }
  }

  if (filters.search && filters.search.trim().length > 0) {
    const term = `%${filters.search.trim()}%`;
    const normSearch = `%${normalizeVehicleReg(filters.search.trim())}%`;
    const phoneSearch = `%${normalizePhone(filters.search.trim())}%`;

    query += ` AND (
      j.client_name LIKE ? OR 
      j.client_phone LIKE ? OR 
      j.client_phone_raw LIKE ? OR 
      j.vehicle_reg LIKE ? OR 
      j.vehicle_reg_raw LIKE ?
    )`;
    params.push(term, phoneSearch, term, normSearch, term);
  }

  query += ` ORDER BY j.channel_partner ASC, j.client_phone ASC, j.created_at DESC`;

  const jobs = await db.queryAll<any>(query, params);

  // Scoped activity computation:
  // Scoped to agents.tag = callback_settings.callback_team_tag AND agents.archived_at IS NULL:
  // - attempt_count: count of events where type = 'CALL' and normalized target_phone equals job's client_phone
  // - sms_count: count of events where type = 'SMS' and normalized target_phone equals job's client_phone
  // - last_attempt_at: most recent matching CALL event timestamp
  const events = await db.queryAll<{ target_phone: string; type: string; timestamp: string }>(
    `SELECT e.target_phone, e.type, e.timestamp
     FROM events e
     JOIN agents a ON e.agent_id = a.id
     WHERE a.tag = ? AND (a.archived_at IS NULL)`,
    [settings.callback_team_tag]
  );

  const phoneActivityMap = new Map<string, { attempt_count: number; sms_count: number; last_attempt_at: string | null }>();

  for (const ev of events) {
    const normP = normalizePhone(ev.target_phone);
    if (!normP) continue;

    let act = phoneActivityMap.get(normP);
    if (!act) {
      act = { attempt_count: 0, sms_count: 0, last_attempt_at: null };
      phoneActivityMap.set(normP, act);
    }

    if (ev.type === "CALL") {
      act.attempt_count += 1;
      if (!act.last_attempt_at || new Date(ev.timestamp) > new Date(act.last_attempt_at)) {
        act.last_attempt_at = ev.timestamp;
      }
    } else if (ev.type === "SMS") {
      act.sms_count += 1;
    }
  }

  return jobs.map((job) => {
    const act = phoneActivityMap.get(job.client_phone) || {
      attempt_count: 0,
      sms_count: 0,
      last_attempt_at: null,
    };

    return {
      id: Number(job.id),
      vehicle_reg: job.vehicle_reg,
      vehicle_reg_raw: job.vehicle_reg_raw,
      client_name: job.client_name,
      client_phone: job.client_phone,
      client_phone_raw: job.client_phone_raw,
      channel_partner: job.channel_partner,
      initiated_date: job.initiated_date,
      brian_reason: job.brian_reason,
      status: job.status,
      assigned_agent_id: job.assigned_agent_id ? Number(job.assigned_agent_id) : null,
      assigned_agent_name: job.assigned_agent_name || null,
      latest_outcome: job.latest_outcome || null,
      first_imported_at: job.first_imported_at,
      last_seen_in_import_at: job.last_seen_in_import_at,
      closed_at: job.closed_at,
      created_at: job.created_at,
      updated_at: job.updated_at,
      attempt_count: act.attempt_count,
      sms_count: act.sms_count,
      sms_sent: act.sms_count > 0,
      last_attempt_at: act.last_attempt_at,
      max_attempts: settings.max_attempts,
    };
  });
}

/**
 * Generate grouped Max Attempts Reached report by Channel Partner
 */
export async function getMaxAttemptsReport(db: DbAdapter): Promise<MaxAttemptsReportGroup[]> {
  await closeMaturedCallbackJobs(db);

  const jobs = await db.queryAll<{
    id: number;
    vehicle_reg_raw: string;
    client_name: string | null;
    client_phone_raw: string;
    channel_partner: string | null;
    initiated_date: string | null;
    closed_at: string | null;
  }>(
    `SELECT id, vehicle_reg_raw, client_name, client_phone_raw, channel_partner, initiated_date, closed_at 
     FROM callback_jobs 
     WHERE latest_outcome = 'MAX_ATTEMPTS_REACHED'
     ORDER BY channel_partner ASC, closed_at DESC`
  );

  const groupsMap = new Map<string, MaxAttemptsReportRecord[]>();

  for (const job of jobs) {
    const partner = String(job.channel_partner || "Unassigned Partner").trim() || "Unassigned Partner";

    const rawLogs = await db.queryAll<{
      id: number;
      outcome: string;
      comment: string;
      logged_by: string;
      created_at: string;
    }>(
      `SELECT id, outcome, comment, logged_by, created_at 
       FROM callback_job_logs 
       WHERE callback_job_id = ? 
       ORDER BY created_at ASC, id ASC`,
      [job.id]
    );

    const attempts: MaxAttemptsReportAttempt[] = rawLogs.map((l, idx) => ({
      attempt_number: idx + 1,
      outcome: l.outcome,
      comment: l.comment,
      logged_by: l.logged_by,
      created_at: l.created_at,
    }));

    const record: MaxAttemptsReportRecord = {
      vehicle_reg_raw: job.vehicle_reg_raw,
      client_name: job.client_name,
      client_phone_raw: job.client_phone_raw,
      initiated_date: job.initiated_date,
      closed_at: job.closed_at,
      attempts,
    };

    if (!groupsMap.has(partner)) {
      groupsMap.set(partner, []);
    }
    groupsMap.get(partner)!.push(record);
  }

  const result: MaxAttemptsReportGroup[] = [];
  for (const [partner, records] of groupsMap.entries()) {
    result.push({
      channel_partner: partner,
      records,
    });
  }

  return result.sort((a, b) => a.channel_partner.localeCompare(b.channel_partner));
}

/**
 * Update single job status
 */
export async function updateCallbackJobStatus(
  db: DbAdapter,
  id: number,
  status: "GREEN" | "AMBER" | "RED"
): Promise<CallbackJob | null> {
  const isClosed = status === "GREEN" || status === "RED";

  if (isClosed) {
    await db.execute(
      `UPDATE callback_jobs SET status = ?, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );
  } else {
    await db.execute(
      `UPDATE callback_jobs SET status = 'AMBER', closed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  }

  const jobs = await getCallbackJobs(db, {});
  return jobs.find((j) => j.id === id) || null;
}
