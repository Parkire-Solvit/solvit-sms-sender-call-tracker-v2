import { DbAdapter } from "./db";
import { markImportRecords } from "./dataReset";
import { 
  CallbackJob, 
  CallbackSettings, 
  CallbackImportSummary, 
  CallbackImportPayload,
  CallbackJobStatus,
  MaxAttemptsReportGroup,
  MaxAttemptsReportRecord,
  MaxAttemptsReportAttempt,
  MaxAttemptsChronologyEntry,
  ChannelPartnerAllocation,
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

const MONTHS: Record<string, number> = {
  JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
  JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11,
};

export function parseFileNameEndDate(fileName: string): Date | null {
  const cleaned = fileName.toUpperCase();
  const yearMatch = cleaned.match(/(\d{4})/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);

  const dateMatches = [...cleaned.matchAll(/(\d{1,2})(?:ST|ND|RD|TH)_([A-Z]+)/g)];
  if (dateMatches.length === 0) return null;

  const last = dateMatches[dateMatches.length - 1];
  const day = Number(last[1]);
  const month = MONTHS[last[2]];
  if (month === undefined || !day) return null;

  const date = new Date(Date.UTC(year, month, day));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Counted call statuses: Count a call attempt only when type is CALL and status is OUTGOING.
 * Do not count CONNECTED (it duplicates the same call), INCOMING or MISSED.
 */
export const COUNTED_CALL_STATUSES = new Set<string>(["OUTGOING"]);

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
 * Extract individual phone numbers from a raw string.
 * Splits on "/", ",", ";", "&", line breaks and the words "or" and "and" (case-insensitive).
 * Does not split on spaces inside a token, so "0702 280749" and "+254 702 280 749" stay one number.
 * If a token still has more than 13 digits, splits it into numbers beginning with 0, 254 or +254.
 * Normalises each to the last 9 digits, discards tokens with fewer than 9 digits,
 * removes duplicates, and treats the first as primary.
 */
export function extractPhoneNumbers(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];

  // Split on "/", ",", ";", "&", line breaks and the words "or" and "and" (case-insensitive)
  const initialTokens = text.split(/[\r\n,;&/]+|\b(?:or|and)\b/i);

  const subTokens: string[] = [];
  for (const token of initialTokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    const digitsOnly = trimmed.replace(/\D/g, "");
    if (digitsOnly.length > 13) {
      // If a token still has more than 13 digits, split it into numbers beginning with 0, 254 or +254
      const parts = trimmed.split(/(?=\s*(?:\+?254|0)\d{8,})/g);
      for (const p of parts) {
        if (p.trim()) subTokens.push(p.trim());
      }
    } else {
      subTokens.push(trimmed);
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const t of subTokens) {
    const norm = normalizePhone(t);
    if (norm.length >= 9 && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }

  return result;
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
 * Vehicle registration alphanumeric normalization (used for SMS reg matching):
 *   - Uppercase.
 *   - Strip every non-alphanumeric character.
 */
export function normalizeRegAlphaNumeric(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Idempotent startup routine that parses client_phone_raw of every existing job
 * and adds any additional numbers as IMPORT.
 */
export async function backfillAdditionalImportPhones(db: DbAdapter): Promise<number> {
  const jobs = await db.queryAll<{ id: number; client_phone_raw: string }>(
    `SELECT id, client_phone_raw FROM callback_jobs WHERE client_phone_raw IS NOT NULL AND client_phone_raw != ''`
  );
  let addedCount = 0;
  for (const job of jobs) {
    const phones = extractPhoneNumbers(job.client_phone_raw);
    for (let i = 1; i < phones.length; i++) {
      const p = phones[i];
      try {
        const res = await db.execute(
          `INSERT INTO callback_job_phones (callback_job_id, phone_normalised, source)
           VALUES (?, ?, 'IMPORT')
           ON CONFLICT (callback_job_id, phone_normalised) DO NOTHING`,
          [job.id, p]
        );
        if (res.affectedRows > 0) addedCount++;
      } catch (_) {}
    }
  }
  if (addedCount > 0) {
    console.log(`[BACKFILL] Backfilled ${addedCount} additional phone number(s) into callback_job_phones.`);
  }
  return addedCount;
}


/**
 * Helper to clamp a threshold between 1 and 20
 */
export function clampThreshold(val: any, fallback = 4): number {
  const n = parseInt(String(val), 10);
  if (isNaN(n)) return fallback;
  return Math.min(20, Math.max(1, n));
}

/**
 * Combined closure rule: job closes as MAX_ATTEMPTS_REACHED only when
 * BOTH conditions are true:
 * (a) it has at least N outgoing calls AND
 * (b) it has at least M SMS
 * Incoming, missed, and connected-only calls are never counted towards calls.
 */
export function hasReachedMaxAttempts(
  activity: { attempt_count: number; sms_count: number },
  settings: { max_attempts: number; max_sms_attempts: number }
): boolean {
  const reqCalls = Number(settings.max_attempts || 4);
  const reqSms = Number(settings.max_sms_attempts || 4);
  return (
    Number(activity.attempt_count || 0) >= reqCalls &&
    Number(activity.sms_count || 0) >= reqSms
  );
}

/**
 * Fetch callback settings or initialize defaults
 */
export async function getCallbackSettings(db: DbAdapter): Promise<CallbackSettings> {
  const row = await db.queryOne<
    CallbackSettings & {
      max_sms_attempts?: number;
      disappearance_alert_fixed_count?: number;
      disappearance_alert_percentage?: number;
    }
  >(
    `SELECT id, staff_count, callback_team_tag, max_attempts, max_sms_attempts, disappearance_alert_fixed_count, disappearance_alert_percentage, updated_at FROM callback_settings WHERE id = 1`
  );

  let teamTag = "Callback Team";
  let maxAttempts = 4;
  let maxSmsAttempts = 4;
  let fixedCount = 50;
  let percentage = 30;

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
    maxAttempts = clampThreshold(row.max_attempts, 4);
    maxSmsAttempts = clampThreshold(row.max_sms_attempts, 4);
    fixedCount = row.disappearance_alert_fixed_count !== undefined && row.disappearance_alert_fixed_count !== null ? Number(row.disappearance_alert_fixed_count) : 50;
    percentage = row.disappearance_alert_percentage !== undefined && row.disappearance_alert_percentage !== null ? Number(row.disappearance_alert_percentage) : 30;
  } else {
    // Insert default if row 1 is missing
    await db.execute(
      `INSERT INTO callback_settings (id, staff_count, callback_team_tag, max_attempts, max_sms_attempts, disappearance_alert_fixed_count, disappearance_alert_percentage) VALUES (1, 0, 'Callback Team', 4, 4, 50, 30) ON CONFLICT (id) DO NOTHING`
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
    max_sms_attempts: maxSmsAttempts,
    disappearance_alert_fixed_count: fixedCount,
    disappearance_alert_percentage: percentage,
    active_agents: activeAgents,
    updated_at: row?.updated_at,
  };
}

/**
 * Update callback settings
 */
export async function updateCallbackSettings(
  db: DbAdapter,
  updates: Partial<Pick<CallbackSettings, "staff_count" | "callback_team_tag" | "max_attempts" | "max_sms_attempts" | "disappearance_alert_fixed_count" | "disappearance_alert_percentage">>
): Promise<CallbackSettings> {
  const current = await getCallbackSettings(db);

  const teamTag = updates.callback_team_tag !== undefined ? String(updates.callback_team_tag).trim() : current.callback_team_tag;
  const maxAttempts = updates.max_attempts !== undefined ? clampThreshold(updates.max_attempts, current.max_attempts) : current.max_attempts;
  const maxSmsAttempts = updates.max_sms_attempts !== undefined ? clampThreshold(updates.max_sms_attempts, current.max_sms_attempts) : current.max_sms_attempts;
  const fixedCount = updates.disappearance_alert_fixed_count !== undefined ? Number(updates.disappearance_alert_fixed_count) : (current.disappearance_alert_fixed_count ?? 50);
  const percentage = updates.disappearance_alert_percentage !== undefined ? Number(updates.disappearance_alert_percentage) : (current.disappearance_alert_percentage ?? 30);

  // Count active agents who have this tag
  const activeAgents = await db.queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM agents WHERE tag = ? AND (archived_at IS NULL) ORDER BY id ASC`,
    [teamTag]
  );
  const autoStaffCount = activeAgents.length;

  await db.execute(
    `UPDATE callback_settings SET staff_count = ?, callback_team_tag = ?, max_attempts = ?, max_sms_attempts = ?, disappearance_alert_fixed_count = ?, disappearance_alert_percentage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    [autoStaffCount, teamTag, maxAttempts, maxSmsAttempts, fixedCount, percentage]
  );

  return {
    id: 1,
    staff_count: autoStaffCount,
    callback_team_tag: teamTag,
    max_attempts: maxAttempts,
    max_sms_attempts: maxSmsAttempts,
    disappearance_alert_fixed_count: fixedCount,
    disappearance_alert_percentage: percentage,
    active_agents: activeAgents,
  };
}

/**
 * Seed channel partner allocations on startup
 */
export async function seedChannelPartnerAllocations(db: DbAdapter): Promise<void> {
  try {
    // Look up Mercy and Caroline agents
    const agents = await db.queryAll<{ id: number; name: string }>(
      `SELECT id, name FROM agents WHERE archived_at IS NULL`
    );
    let mercy = agents.find((a) => a.name.trim().toLowerCase() === "mercy");
    let caroline = agents.find((a) => a.name.trim().toLowerCase() === "caroline");

    if (!mercy) {
      await db.execute(`INSERT INTO agents (name, tag) VALUES ('Mercy', 'Callback Team') ON CONFLICT (name) DO NOTHING`);
      mercy = (await db.queryOne<{ id: number; name: string }>(`SELECT id, name FROM agents WHERE LOWER(name) = 'mercy'`)) || undefined;
    }
    if (!caroline) {
      await db.execute(`INSERT INTO agents (name, tag) VALUES ('Caroline', 'Callback Team') ON CONFLICT (name) DO NOTHING`);
      caroline = (await db.queryOne<{ id: number; name: string }>(`SELECT id, name FROM agents WHERE LOWER(name) = 'caroline'`)) || undefined;
    }

    const mercyId = mercy ? mercy.id : null;
    const carolineId = caroline ? caroline.id : null;

    const allocations: Array<{ partner: string; agentId: number | null }> = [
      // Mercy
      { partner: "Britam", agentId: mercyId },
      { partner: "Sanlam Allianz", agentId: mercyId },
      { partner: "GA Insurance", agentId: mercyId },
      { partner: "OLD MUTUAL", agentId: mercyId },
      { partner: "Heritage", agentId: mercyId },
      { partner: "Pioneer General Insurance Limited", agentId: mercyId },
      { partner: "ICEA Lion", agentId: mercyId },
      { partner: "Takaful", agentId: mercyId },
      { partner: "Pioneer", agentId: mercyId },
      { partner: "Madison", agentId: mercyId },
      { partner: "Cannon", agentId: mercyId },
      { partner: "Lami World", agentId: mercyId },
      { partner: "Intra Africa", agentId: mercyId },
      { partner: "DIRECTLINE INSURANCE", agentId: mercyId },
      { partner: "Sanlam", agentId: mercyId },
      { partner: "Mayfair Insurance", agentId: mercyId },

      // Caroline
      { partner: "APA", agentId: carolineId },
      { partner: "KENINDIA ASSURANCE COMPANY LTD", agentId: carolineId },
      { partner: "Fidelity", agentId: carolineId },
      { partner: "First Assurance", agentId: carolineId },
      { partner: "CIC General Insurance Ltd", agentId: carolineId },
      { partner: "PACIS Insurance", agentId: carolineId },
      { partner: "Occidental", agentId: carolineId },
      { partner: "NCBA-IG", agentId: carolineId },
      { partner: "Definite Assurance Co. Limited.", agentId: carolineId },
      { partner: "MUA", agentId: carolineId },
      { partner: "Geminia Insurance Company Limited", agentId: carolineId },
      { partner: "AAR Insurance", agentId: carolineId },
      { partner: "AMACO INSURANCE LTD", agentId: carolineId },
      { partner: "STAR DISCOVER INSURANCE COMPANY LIMITED", agentId: carolineId },
      { partner: "Choice Microfinance Bank Limited", agentId: carolineId },
      { partner: "Nirvana Microfinance Bank Limited", agentId: carolineId },
    ];

    const validPartners = allocations.map((a) => a.partner);
    await db.execute(
      `DELETE FROM channel_partner_allocations WHERE channel_partner NOT IN (${validPartners.map(() => '?').join(',')})`,
      validPartners
    );

    for (const alloc of allocations) {
      await db.execute(
        `INSERT INTO channel_partner_allocations (channel_partner, assigned_agent_id, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (channel_partner) DO UPDATE SET assigned_agent_id = EXCLUDED.assigned_agent_id, updated_at = CURRENT_TIMESTAMP`,
        [alloc.partner, alloc.agentId]
      );
    }
    console.log("[ALLOCATIONS] Successfully seeded/updated channel_partner_allocations");

    const allocations2 = await db.queryAll<{ channel_partner: string; assigned_agent_id: number }>(
      `SELECT channel_partner, assigned_agent_id FROM channel_partner_allocations WHERE assigned_agent_id IS NOT NULL`
    );
    for (const alloc of allocations2) {
      await db.execute(
        `UPDATE callback_jobs SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE channel_partner = ? AND status = 'AMBER'`,
        [alloc.assigned_agent_id, alloc.channel_partner]
      );
    }
    console.log("[ALLOCATIONS] Resynced open jobs against corrected allocation table");
  } catch (err) {
    console.error("[ALLOCATIONS] Error seeding channel partner allocations:", err);
  }
}

/**
 * Get all partner allocations and unallocated partners in callback_jobs
 */
export async function getChannelPartnerAllocations(db: DbAdapter): Promise<{
  allocations: Array<{
    channel_partner: string;
    assigned_agent_id: number | null;
    assigned_agent_name: string | null;
    updated_at: string | null;
  }>;
  unallocated_partners: string[];
}> {
  const rows = await db.queryAll<{
    channel_partner: string;
    assigned_agent_id: number | null;
    assigned_agent_name: string | null;
    updated_at: string | null;
  }>(
    `SELECT cpa.channel_partner, cpa.assigned_agent_id, a.name as assigned_agent_name, cpa.updated_at
     FROM channel_partner_allocations cpa
     LEFT JOIN agents a ON cpa.assigned_agent_id = a.id
     ORDER BY cpa.channel_partner ASC`
  );

  const unallocatedRows = await db.queryAll<{ channel_partner: string }>(
    `SELECT DISTINCT channel_partner
     FROM callback_jobs
     WHERE channel_partner IS NOT NULL AND TRIM(channel_partner) != ''
       AND channel_partner NOT IN (SELECT channel_partner FROM channel_partner_allocations)
     ORDER BY channel_partner ASC`
  );

  return {
    allocations: rows,
    unallocated_partners: unallocatedRows.map((r) => r.channel_partner),
  };
}

/**
 * Set partner allocation and immediately reassign open AMBER jobs
 */
export async function setChannelPartnerAllocation(
  db: DbAdapter,
  channelPartner: string,
  assignedAgentId: number | null
): Promise<void> {
  const partner = channelPartner.trim();
  if (!partner) throw new Error("Channel partner name is required");

  // Upsert into channel_partner_allocations
  const existing = await db.queryOne<{ channel_partner: string }>(
    `SELECT channel_partner FROM channel_partner_allocations WHERE channel_partner = ?`,
    [partner]
  );
  if (existing) {
    await db.execute(
      `UPDATE channel_partner_allocations SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE channel_partner = ?`,
      [assignedAgentId, partner]
    );
  } else {
    await db.execute(
      `INSERT INTO channel_partner_allocations (channel_partner, assigned_agent_id, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [partner, assignedAgentId]
    );
  }

  // Immediately update every open AMBER vehicle for that partner to the new assigned_agent_id
  await db.execute(
    `UPDATE callback_jobs 
     SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE channel_partner = ? AND status = 'AMBER'`,
    [assignedAgentId, partner]
  );
}

/**
 * Reconcile clients whose open AMBER vehicles are currently split across multiple agents.
 * Keeps the agent from the vehicle imported earliest.
 */
export async function reconcileClientAgentAssignments(db: DbAdapter): Promise<{ clientsFixed: number; jobsUpdated: number }> {
  const splitPhones = await db.queryAll<{ phone_normalised: string }>(
    `SELECT p.phone_normalised
     FROM callback_job_phones p
     JOIN callback_jobs j ON p.callback_job_id = j.id
     WHERE j.assigned_agent_id IS NOT NULL AND j.status = 'AMBER'
     GROUP BY p.phone_normalised
     HAVING COUNT(DISTINCT j.assigned_agent_id) > 1`
  );

  let clientsFixed = 0;
  let jobsUpdated = 0;

  for (const { phone_normalised } of splitPhones) {
    const earliest = await db.queryOne<{ assigned_agent_id: number }>(
      `SELECT j.assigned_agent_id
       FROM callback_jobs j
       JOIN callback_job_phones p ON p.callback_job_id = j.id
       WHERE p.phone_normalised = ? AND j.assigned_agent_id IS NOT NULL
       ORDER BY j.first_imported_at ASC LIMIT 1`,
      [phone_normalised]
    );
    if (!earliest) continue;

    const result = await db.execute(
      `UPDATE callback_jobs SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (SELECT callback_job_id FROM callback_job_phones WHERE phone_normalised = ?)
         AND status = 'AMBER' AND assigned_agent_id != ?`,
      [earliest.assigned_agent_id, phone_normalised, earliest.assigned_agent_id]
    );
    if (result.affectedRows > 0) {
      clientsFixed++;
      jobsUpdated += result.affectedRows;
    }
  }

  console.log(`[RECONCILE] Fixed ${clientsFixed} split clients, updated ${jobsUpdated} open jobs`);
  return { clientsFixed, jobsUpdated };
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
  const createdJobIds: number[] = [];
  const absentClosedJobIds: number[] = [];

  // Load existing partner allocations
  const allocations = await db.queryAll<{ channel_partner: string; assigned_agent_id: number | null }>(
    `SELECT channel_partner, assigned_agent_id FROM channel_partner_allocations`
  );
  const partnerAllocMap = new Map<string, number | null>();
  for (const a of allocations) {
    if (a.channel_partner) {
      partnerAllocMap.set(a.channel_partner.trim().toLowerCase(), a.assigned_agent_id);
    }
  }

  for (const row of rows) {
    const rawReg = String(row.vehicle_reg || "").trim();
    const rawPhone = String(row.client_phone || "").trim();
    const clientName = row.client_name ? String(row.client_name).trim() : null;
    const channelPartner = row.channel_partner ? String(row.channel_partner).trim() : null;
    const initiatedDate = row.initiated_date ? String(row.initiated_date).trim() : null;
    const brianReason = row.reason ? String(row.reason).trim() : null;
    const customerEmail = row.customer_email ? String(row.customer_email).trim() : null;

    const normReg = normalizeVehicleReg(rawReg);
    const extractedPhones = extractPhoneNumbers(rawPhone);

    // Skip row only when no valid number is found or reg is empty
    if (!normReg || extractedPhones.length === 0) {
      continue;
    }

    const normPhone = extractedPhones[0];

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
        // Still AMBER: update last_seen_in_import_at to now. Update email if newly provided.
        if (customerEmail) {
          await db.execute(
            `UPDATE callback_jobs SET last_seen_in_import_at = CURRENT_TIMESTAMP, customer_email = COALESCE(customer_email, ?) WHERE id = ?`,
            [customerEmail, existing.id]
          );
        } else {
          await db.execute(
            `UPDATE callback_jobs SET last_seen_in_import_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [existing.id]
          );
        }

        // Store all extracted numbers in callback_job_phones
        for (let i = 0; i < extractedPhones.length; i++) {
          const p = extractedPhones[i];
          const src = i === 0 ? "PRIMARY" : "IMPORT";
          await db.execute(
            `INSERT INTO callback_job_phones (callback_job_id, phone_normalised, source)
             VALUES (?, ?, ?)
             ON CONFLICT (callback_job_id, phone_normalised) DO NOTHING`,
            [existing.id, p, src]
          );
        }

        skippedOpenCount++;
      }
    } else {
      // Find assigned_agent_id:
      // Treat clients as the same when ANY number overlaps
      let assignedAgentId: number | null = null;

      const placeholders = extractedPhones.map(() => "?").join(",");
      const existingClientAssignment = await db.queryOne<{ assigned_agent_id: number | null }>(
        `SELECT j.assigned_agent_id
         FROM callback_jobs j
         LEFT JOIN callback_job_phones p ON p.callback_job_id = j.id
         WHERE (j.client_phone IN (${placeholders}) OR p.phone_normalised IN (${placeholders}))
           AND j.assigned_agent_id IS NOT NULL
         ORDER BY j.first_imported_at ASC LIMIT 1`,
        [...extractedPhones, ...extractedPhones]
      );

      if (existingClientAssignment?.assigned_agent_id) {
        assignedAgentId = existingClientAssignment.assigned_agent_id;
      } else if (channelPartner) {
        const pKey = channelPartner.trim().toLowerCase();
        if (partnerAllocMap.has(pKey)) {
          assignedAgentId = partnerAllocMap.get(pKey) ?? null;
        }
      }

      // Insert new row at status = 'AMBER'
      const insertResult = await db.execute(
        `INSERT INTO callback_jobs (
          vehicle_reg, vehicle_reg_raw, client_name, client_phone, client_phone_raw, customer_email,
          channel_partner, initiated_date, brian_reason, status, assigned_agent_id,
          first_imported_at, last_seen_in_import_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AMBER', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          normReg,
          rawReg,
          clientName,
          normPhone,
          rawPhone,
          customerEmail,
          channelPartner,
          initiatedDate,
          brianReason,
          assignedAgentId,
        ]
      );

      const newJobId = insertResult.lastInsertId;
      createdJobIds.push(Number(newJobId));

      // Store all extracted numbers in callback_job_phones
      for (let i = 0; i < extractedPhones.length; i++) {
        const p = extractedPhones[i];
        const src = i === 0 ? "PRIMARY" : "IMPORT";
        await db.execute(
          `INSERT INTO callback_job_phones (callback_job_id, phone_normalised, source)
           VALUES (?, ?, ?)
           ON CONFLICT (callback_job_id, phone_normalised) DO NOTHING`,
          [newJobId, p, src]
        );
      }

      newRecordsCount++;
    }
  }

  // Disappearance check
  const uploadRegs = new Set(
    rows.map((r) => normalizeVehicleReg(r.vehicle_reg)).filter(Boolean)
  );

  let autoClosedAbsentCount = 0;
  let missingJobs: { id: number; vehicle_reg: string }[] = [];

  if (uploadRegs.size > 0) {
    const openJobs = await db.queryAll<{ id: number; vehicle_reg: string }>(
      `SELECT id, vehicle_reg FROM callback_jobs WHERE status = 'AMBER'`
    );
    missingJobs = openJobs.filter((job) => !uploadRegs.has(job.vehicle_reg));
  }

  const settings = await getCallbackSettings(db);
  const totalOpenRow = await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM callback_jobs WHERE status = 'AMBER'`
  );
  const totalCurrentlyOpen = Number(totalOpenRow?.cnt || 0);
  const wouldCloseCount = missingJobs.length;
  const wouldClosePercentage = totalCurrentlyOpen > 0 ? Math.round((wouldCloseCount / totalCurrentlyOpen) * 100) : 0;

  const fixedAlertLimit = settings.disappearance_alert_fixed_count ?? 50;
  const percentageAlertLimit = settings.disappearance_alert_percentage ?? 30;

  const exceedsCount = wouldCloseCount > fixedAlertLimit;
  const exceedsPercentage = wouldClosePercentage > percentageAlertLimit;

  const parsedEndDate = parseFileNameEndDate(fileName);
  let filenameWarning: string | null = null;
  if (parsedEndDate) {
    const lastImport = await db.queryOne<{ parsed_end_date: string | null; file_name: string }>(
      `SELECT parsed_end_date, file_name FROM callback_imports WHERE parsed_end_date IS NOT NULL ORDER BY imported_at DESC LIMIT 1`
    );
    if (lastImport?.parsed_end_date && parsedEndDate < new Date(lastImport.parsed_end_date)) {
      filenameWarning = `This file's date range appears to end before your last upload (${lastImport.file_name}). You may be uploading an older file.`;
    }
  }

  const needsConfirmation = (exceedsCount || exceedsPercentage || !!filenameWarning) && !payload.confirmed;

  if (!needsConfirmation) {
    for (const job of missingJobs) {
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
      absentClosedJobIds.push(Number(job.id));
      autoClosedAbsentCount++;
    }
  }

  const parsedEndDateStr = parsedEndDate ? parsedEndDate.toISOString().split('T')[0] : null;

  // Insert callback_imports record
  const importInsert = await db.execute(
    `INSERT INTO callback_imports (
      file_name, imported_by, row_count_total, new_records_count, skipped_open_count, skipped_closed_count, auto_closed_absent_count, parsed_end_date, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      fileName,
      importedBy,
      rows.length,
      newRecordsCount,
      skippedOpenCount,
      skippedClosedCount,
      autoClosedAbsentCount,
      parsedEndDateStr,
    ]
  );

  // Remember what this upload created and closed, so "Remove last upload" can undo it.
  // A failure here must never fail the upload itself.
  try {
    await markImportRecords(db, "callbacks", Number(importInsert.lastInsertId), createdJobIds, absentClosedJobIds);
  } catch (err) {
    console.error("[CALLBACKS] Could not record upload markers:", err);
  }

  // Full sweep of matured callback jobs
  await closeMaturedCallbackJobs(db);

  if (needsConfirmation) {
    return {
      requiresConfirmation: true,
      wouldCloseCount,
      wouldClosePercentage,
      totalCurrentlyOpen,
      filenameWarning,
      row_count_total: rows.length,
      new_records_count: newRecordsCount,
      skipped_open_count: skippedOpenCount,
      skipped_closed_count: skippedClosedCount,
    };
  }

  return {
    row_count_total: rows.length,
    new_records_count: newRecordsCount,
    skipped_open_count: skippedOpenCount,
    skipped_closed_count: skippedClosedCount,
    auto_closed_absent_count: autoClosedAbsentCount,
  };
}

export interface JobActivityMetrics {
  attempt_count: number;
  sms_count: number;
  last_attempt_at: string | null;
}

/**
 * Shared helper: returns agents that are not archived and match the callback team tag.
 * Uses exactly the same conditions that computeCallbackJobsActivity uses.
 */
export async function getValidCallbackAgents(
  db: DbAdapter,
  teamTag?: string
): Promise<Array<{ id: number; name: string }>> {
  const tag = (teamTag || "Callback Team").trim().toLowerCase();
  return db.queryAll<{ id: number; name: string }>(
    `SELECT id, name FROM agents WHERE LOWER(TRIM(tag)) = LOWER(TRIM(?)) AND archived_at IS NULL`,
    [tag]
  );
}

/**
 * Shared helper: returns the Set of agent IDs that are not archived and match the callback team tag.
 */
export async function getValidCallbackAgentIds(
  db: DbAdapter,
  teamTag?: string
): Promise<Set<number>> {
  const agents = await getValidCallbackAgents(db, teamTag);
  return new Set(agents.map((a) => a.id));
}

/**
 * Shared activity computation engine for callback jobs.
 * Used by both getCallbackJobs and closeMaturedCallbackJobs so they can never disagree.
 *
 * Rules:
 * - Compares callback team tag using LOWER(TRIM()) on both sides, excluding archived agents.
 * - Call attempts counted only when type is CALL and status is OUTGOING (from COUNTED_CALL_STATUSES).
 *   Does not count CONNECTED, INCOMING, or MISSED.
 * - SMS counting counted when type is SMS.
 * - An event counts toward a job when:
 *     1. The event's agent is the job's assigned agent.
 *     2. AND:
 *        - For CALL: its normalised phone equals ANY number in callback_job_phones for that job.
 *        - For SMS: its normalised phone equals ANY number in callback_job_phones for that job
 *                   OR its reg_no (alphanumeric normalised) equals the job's vehicle_reg (alphanumeric normalised).
 * - An event is never counted twice for the same job.
 */
export async function computeCallbackJobsActivity(
  db: DbAdapter,
  jobs: Array<{ id: number; assigned_agent_id: number | null; vehicle_reg: string; client_phone?: string }>
): Promise<Map<number, JobActivityMetrics>> {
  const result = new Map<number, JobActivityMetrics>();
  // PostgreSQL BIGINT/FK values can be strings while related SERIAL values are
  // numbers. Canonical string keys keep the same database ID comparable across
  // jobs, phone rows, events and aggregate history queries.
  const keyOf = (value: string | number | null | undefined) => String(value ?? "");
  const activityByJobKey = new Map<string, JobActivityMetrics>();
  const countedCallEvents = new Map<string, Set<number>>();
  const countedSmsEvents = new Map<string, Set<number>>();

  for (const j of jobs) {
    const activity = { attempt_count: 0, sms_count: 0, last_attempt_at: null };
    result.set(j.id, activity);
    activityByJobKey.set(keyOf(j.id), activity);
    countedCallEvents.set(keyOf(j.id), new Set<number>());
    countedSmsEvents.set(keyOf(j.id), new Set<number>());
  }

  if (jobs.length === 0) return result;

  const settings = await getCallbackSettings(db);
  const teamTag = (settings.callback_team_tag || "Callback Team").trim().toLowerCase();

  // Query events scoped to non-archived agents matching teamTag
  const events = await db.queryAll<{
    id: number;
    target_phone: string;
    type: string;
    status: string | null;
    reg_no: string | null;
    timestamp: string;
    agent_id: number;
  }>(
    `SELECT e.id, e.target_phone, e.type, e.status, e.reg_no, e.timestamp, e.agent_id
     FROM events e
     JOIN agents a ON e.agent_id = a.id
     WHERE LOWER(TRIM(a.tag)) = LOWER(TRIM(?)) AND (a.archived_at IS NULL)
     ORDER BY e.timestamp ASC`,
    [teamTag]
  );

  // Fetch all phone numbers associated with the jobs
  const allPhones = await db.queryAll<{ callback_job_id: number; phone_normalised: string }>(
    `SELECT callback_job_id, phone_normalised FROM callback_job_phones`
  );
  const jobPhonesMap = new Map<string, Set<string>>();
  for (const p of allPhones) {
    const jobKey = keyOf(p.callback_job_id);
    let set = jobPhonesMap.get(jobKey);
    if (!set) {
      set = new Set<string>();
      jobPhonesMap.set(jobKey, set);
    }
    set.add(p.phone_normalised);
  }

  // Also ensure client_phone on the job is included in the lookup set
  for (const j of jobs) {
    if (j.client_phone) {
      const jobKey = keyOf(j.id);
      let set = jobPhonesMap.get(jobKey);
      if (!set) {
        set = new Set<string>();
        jobPhonesMap.set(jobKey, set);
      }
      const norm = normalizePhone(j.client_phone);
      if (norm) set.add(norm);
    }
  }

  // Group candidate jobs by assigned_agent_id
  const jobsByAgent = new Map<string, typeof jobs>();
  for (const j of jobs) {
    if (j.assigned_agent_id !== null) {
      const agentKey = keyOf(j.assigned_agent_id);
      const list = jobsByAgent.get(agentKey) || [];
      list.push(j);
      jobsByAgent.set(agentKey, list);
    }
  }

  for (const ev of events) {
    if (!ev.agent_id) continue;
    const candidateJobs = jobsByAgent.get(keyOf(ev.agent_id));
    if (!candidateJobs || candidateJobs.length === 0) continue;

    const normEvPhone = normalizePhone(ev.target_phone);
    const normEvReg = normalizeRegAlphaNumeric(ev.reg_no);
    const isCall = ev.type === "CALL" && COUNTED_CALL_STATUSES.has(String(ev.status || "").toUpperCase());
    const isSms = ev.type === "SMS";

    if (!isCall && !isSms) continue;

    for (const job of candidateJobs) {
      const jobKey = keyOf(job.id);
      const phones = jobPhonesMap.get(jobKey);
      const phoneMatches = Boolean(normEvPhone && phones && phones.has(normEvPhone));

      if (isCall && phoneMatches) {
        const set = countedCallEvents.get(jobKey)!;
        if (!set.has(ev.id)) {
          set.add(ev.id);
          const act = result.get(job.id)!;
          act.attempt_count += 1;
          if (!act.last_attempt_at || new Date(ev.timestamp) > new Date(act.last_attempt_at)) {
            act.last_attempt_at = ev.timestamp;
          }
        }
      } else if (isSms) {
        const regMatches = Boolean(normEvReg && normEvReg === normalizeRegAlphaNumeric(job.vehicle_reg));
        if (phoneMatches || regMatches) {
          const set = countedSmsEvents.get(jobKey)!;
          if (!set.has(ev.id)) {
            set.add(ev.id);
            const act = result.get(job.id)!;
            act.sms_count += 1;
          }
        }
      }
    }
  }

  // Outcome logging is also a supported callback workflow. A saved agent outcome
  // represents a completed call attempt even when the Android phone event has not
  // synced (or cannot be matched because the handset/agent assignment changed).
  // Use the greater count rather than adding the two sources so the same call is
  // not counted twice after its device event eventually arrives.
  const manualAttempts = await db.queryAll<{
    callback_job_id: number;
    attempt_count: number;
    last_attempt_at: string | null;
  }>(
    `SELECT callback_job_id,
            COUNT(*) AS attempt_count,
            MAX(created_at) AS last_attempt_at
     FROM callback_job_logs
     WHERE LOWER(COALESCE(logged_by, '')) <> 'system'
     GROUP BY callback_job_id`
  );

  for (const manual of manualAttempts) {
    const act = activityByJobKey.get(keyOf(manual.callback_job_id));
    if (!act) continue;
    act.attempt_count = Math.max(act.attempt_count, Number(manual.attempt_count || 0));
    if (
      manual.last_attempt_at &&
      (!act.last_attempt_at || new Date(manual.last_attempt_at) > new Date(act.last_attempt_at))
    ) {
      act.last_attempt_at = manual.last_attempt_at;
    }
  }

  return result;
}

/**
 * Close any AMBER jobs whose attempts have reached or exceeded callback_settings.max_attempts
 */
export async function closeMaturedCallbackJobs(db: DbAdapter, jobId?: number): Promise<number> {
  const settings = await getCallbackSettings(db);
  const maxAttempts = settings.max_attempts;

  let query = `SELECT id, vehicle_reg, client_phone, assigned_agent_id FROM callback_jobs WHERE status = 'AMBER'`;
  const params: any[] = [];
  if (jobId !== undefined && jobId !== null) {
    query += ` AND id = ?`;
    params.push(jobId);
  }

  const openJobs = await db.queryAll<{ id: number; vehicle_reg: string; client_phone: string; assigned_agent_id: number | null }>(query, params);
  if (openJobs.length === 0) {
    return 0;
  }

  const metricsMap = await computeCallbackJobsActivity(db, openJobs);
  let closedCount = 0;

  for (const job of openJobs) {
    const act = metricsMap.get(job.id) || { attempt_count: 0, sms_count: 0, last_attempt_at: null };
    if (hasReachedMaxAttempts(act, settings)) {
      await db.execute(
        `UPDATE callback_jobs 
         SET status = 'RED', closed_at = CURRENT_TIMESTAMP, latest_outcome = 'MAX_ATTEMPTS_REACHED', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [job.id]
      );
      await db.execute(
        `INSERT INTO callback_job_logs (
          callback_job_id, outcome, comment, logged_by, resulting_status, created_at
        ) VALUES (?, 'MAX_ATTEMPTS_REACHED', 'Automatically closed: minimum outgoing calls and minimum SMS reached.', 'System', 'RED', CURRENT_TIMESTAMP)`,
        [job.id]
      );
      closedCount++;
    }
  }

  console.log(`[CALLBACKS] closeMaturedCallbackJobs checked ${openJobs.length} open job(s). Closed ${closedCount} matured job(s).`);
  return closedCount;
}

/**
 * Log outcome for a callback job
 */
export async function logCallbackOutcome(
  db: DbAdapter,
  jobId: number,
  outcome: string,
  comment: string | null = null,
  loggedBy: string | null = null
): Promise<CallbackJob> {
  const cleanOutcome = String(outcome || "").trim().toUpperCase();
  const cleanComment = String(comment || "").trim();
  const cleanLoggedBy = String(loggedBy || "").trim() || "Agent";

  if (!VALID_AGENT_OUTCOMES.has(cleanOutcome)) {
    throw new Error(`Invalid outcome '${outcome}'. Allowed values: ${Array.from(VALID_AGENT_OUTCOMES).join(", ")}`);
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

  // Insert callback_job_logs (comment is optional, empty string if not provided)
  await db.execute(
    `INSERT INTO callback_job_logs (
      callback_job_id, outcome, comment, logged_by, resulting_status, created_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [jobId, cleanOutcome, cleanComment || "", cleanLoggedBy, resultingStatus]
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
      j.customer_email,
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
    if (rawVal === "UNASSIGNED" || rawVal === "unassigned") {
      query += ` AND j.assigned_agent_id IS NULL`;
    } else if (/^\d+$/.test(rawVal)) {
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

  // Compute metrics using shared helper
  const metricsMap = await computeCallbackJobsActivity(db, jobs);

  // Fetch phones for all jobs
  const phoneRows = await db.queryAll<{ id: number; callback_job_id: number; phone_normalised: string; source: any }>(
    `SELECT id, callback_job_id, phone_normalised, source FROM callback_job_phones`
  );
  const phonesByJobId = new Map<number, Array<{ id: number; phone_normalised: string; source: any }>>();
  for (const pr of phoneRows) {
    let list = phonesByJobId.get(pr.callback_job_id);
    if (!list) {
      list = [];
      phonesByJobId.set(pr.callback_job_id, list);
    }
    list.push({ id: pr.id, phone_normalised: pr.phone_normalised, source: pr.source });
  }

  return jobs.map((job) => {
    const act = metricsMap.get(job.id) || {
      attempt_count: 0,
      sms_count: 0,
      last_attempt_at: null,
    };

    const phones = phonesByJobId.get(job.id) || [
      { id: 0, phone_normalised: job.client_phone, source: "PRIMARY" as const },
    ];

    return {
      id: Number(job.id),
      vehicle_reg: job.vehicle_reg,
      vehicle_reg_raw: job.vehicle_reg_raw,
      client_name: job.client_name,
      client_phone: job.client_phone,
      client_phone_raw: job.client_phone_raw,
      customer_email: job.customer_email || null,
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
      phones,
      attempt_count: act.attempt_count,
      sms_count: act.sms_count,
      sms_sent: act.sms_count > 0,
      last_attempt_at: act.last_attempt_at,
      max_attempts: settings.max_attempts,
      max_sms_attempts: settings.max_sms_attempts,
    };
  });
}

/**
 * Assign a callback job to an agent (or unassign).
 * Validates agent existence, non-archived status, and callback_team_tag.
 * When applyToClient is true, also updates every other job sharing any phone
 * that is AMBER or currently unassigned.
 */
export async function assignCallbackJob(
  db: DbAdapter,
  jobId: number,
  agentId: number | null,
  applyToClient = true
): Promise<CallbackJob> {
  const job = await db.queryOne<{ id: number; client_phone: string; status: string }>(
    `SELECT id, client_phone, status FROM callback_jobs WHERE id = ?`,
    [jobId]
  );
  if (!job) throw new Error(`Callback job with ID ${jobId} not found.`);

  if (agentId !== null) {
    const agent = await db.queryOne<{ id: number; name: string; tag: string; archived_at: any }>(
      `SELECT id, name, tag, archived_at FROM agents WHERE id = ?`,
      [agentId]
    );
    if (!agent) throw new Error(`Agent with ID ${agentId} not found.`);
    if (agent.archived_at) throw new Error(`Cannot assign to archived agent '${agent.name}'.`);

    const settings = await getCallbackSettings(db);
    const teamTag = (settings.callback_team_tag || "Callback Team").trim().toLowerCase();
    const agentTag = (agent.tag || "").trim().toLowerCase();
    if (agentTag !== teamTag) {
      throw new Error(`Agent '${agent.name}' is tagged '${agent.tag}', which does not match the callback team (${settings.callback_team_tag}).`);
    }
  }

  // Update target job (works for AMBER, GREEN, and RED)
  await db.execute(
    `UPDATE callback_jobs SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [agentId, jobId]
  );

  // If applyToClient is true, assign every other job of the same client
  // (any shared phone in callback_job_phones) that is AMBER or unassigned
  if (applyToClient) {
    const jobPhoneRows = await db.queryAll<{ phone_normalised: string }>(
      `SELECT phone_normalised FROM callback_job_phones WHERE callback_job_id = ?`,
      [jobId]
    );
    const phones = new Set(jobPhoneRows.map((r) => r.phone_normalised).filter(Boolean));
    if (job.client_phone) phones.add(normalizePhone(job.client_phone));

    if (phones.size > 0) {
      const phoneList = Array.from(phones);
      const placeholders = phoneList.map(() => "?").join(",");

      const matchingOtherJobs = await db.queryAll<{ id: number }>(
        `SELECT DISTINCT j.id
         FROM callback_jobs j
         LEFT JOIN callback_job_phones p ON p.callback_job_id = j.id
         WHERE (j.client_phone IN (${placeholders}) OR p.phone_normalised IN (${placeholders}))
           AND j.id != ?
           AND (j.status = 'AMBER' OR j.assigned_agent_id IS NULL)`,
        [...phoneList, ...phoneList, jobId]
      );

      for (const other of matchingOtherJobs) {
        await db.execute(
          `UPDATE callback_jobs SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [agentId, other.id]
        );
      }
    }
  }

  // Check matured status for freshly assigned job
  await closeMaturedCallbackJobs(db, jobId);

  const fresh = await getCallbackJobs(db, {});
  const updated = fresh.find((j) => j.id === jobId);
  if (!updated) throw new Error("Failed to retrieve updated job.");
  return updated;
}

/**
 * Bulk assign jobs
 */
export async function assignCallbackJobsBulk(
  db: DbAdapter,
  jobIds: number[],
  agentId: number | null
): Promise<{ updatedCount: number }> {
  let count = 0;
  for (const id of jobIds) {
    try {
      await assignCallbackJob(db, id, agentId, true);
      count++;
    } catch (err) {
      console.warn(`[ASSIGN BULK] Failed to assign job ${id}:`, err);
    }
  }
  return { updatedCount: count };
}

/**
 * Add a manual phone number to a callback job
 */
export async function addPhoneToCallbackJob(
  db: DbAdapter,
  jobId: number,
  phone: string
): Promise<{ success: boolean; callback_job_id: number; phone_normalised: string; source: string }> {
  const norm = normalizePhone(phone);
  if (!norm || norm.length < 9) {
    throw new Error("Invalid phone number (must contain at least 9 digits).");
  }

  const job = await db.queryOne<{ id: number }>("SELECT id FROM callback_jobs WHERE id = ?", [jobId]);
  if (!job) throw new Error(`Callback job with ID ${jobId} not found.`);

  await db.execute(
    `INSERT INTO callback_job_phones (callback_job_id, phone_normalised, source)
     VALUES (?, ?, 'MANUAL')
     ON CONFLICT (callback_job_id, phone_normalised) DO NOTHING`,
    [jobId, norm]
  );

  return { success: true, callback_job_id: jobId, phone_normalised: norm, source: "MANUAL" };
}

/**
 * Get unmatched activity for the last N days
 */
export async function getUnmatchedActivity(
  db: DbAdapter,
  days = 14
): Promise<Array<{
  id: number;
  timestamp: string;
  agent_id: number | null;
  agent_name: string;
  type: string;
  status: string | null;
  target_phone: string;
  reg_no: string | null;
  reason: "NO_JOB_FOR_NUMBER" | "ASSIGNED_TO_OTHER_AGENT" | "UNRECOGNISED_AGENT";
  suggested_job: {
    id: number;
    vehicle_reg: string;
    assigned_agent_id: number | null;
    assigned_agent_name: string | null;
  } | null;
}>> {
  const windowDays = Math.min(Math.max(1, Number(days) || 14), 90);
  const settings = await getCallbackSettings(db);
  const teamTag = (settings.callback_team_tag || "Callback Team").trim().toLowerCase();

  const timeCondition = db.type === "postgresql"
    ? `CURRENT_TIMESTAMP - INTERVAL '${windowDays} days'`
    : `datetime(CURRENT_TIMESTAMP, '-${windowDays} days')`;

  // Query events made by agents tagged with teamTag OR needs_review = true,
  // excluding Unknown Agent and internal contacts
  const events = await db.queryAll<{
    id: number;
    timestamp: string;
    agent_id: number;
    agent_name: string;
    agent_tag: string;
    needs_review: any;
    type: string;
    status: string | null;
    target_phone: string;
    reg_no: string | null;
  }>(
    `SELECT e.id, e.timestamp, e.agent_id, COALESCE(a.name, 'Unknown Agent') as agent_name,
            COALESCE(a.tag, 'Uncategorised') as agent_tag, COALESCE(a.needs_review, FALSE) as needs_review,
            e.type, e.status, e.target_phone, e.reg_no
     FROM events e
     JOIN agents a ON e.agent_id = a.id
     WHERE a.name != 'Unknown Agent'
       AND (a.archived_at IS NULL)
       AND (LOWER(TRIM(a.tag)) = LOWER(TRIM(?)) OR a.needs_review = TRUE)
       AND e.timestamp >= ${timeCondition}
       AND NOT EXISTS (SELECT 1 FROM internal_contacts ic WHERE ic.phone_number = e.target_phone)
     ORDER BY e.timestamp DESC`,
    [teamTag]
  );

  const candidateEvents = events.filter((ev) => {
    if (ev.type === "CALL") {
      return COUNTED_CALL_STATUSES.has(String(ev.status || "").toUpperCase());
    }
    if (ev.type === "SMS") {
      return true;
    }
    return false;
  });

  const allJobs = await db.queryAll<{
    id: number;
    vehicle_reg: string;
    vehicle_reg_raw: string;
    client_phone: string;
    assigned_agent_id: number | null;
    assigned_agent_name: string | null;
  }>(
    `SELECT j.id, j.vehicle_reg, j.vehicle_reg_raw, j.client_phone, j.assigned_agent_id, a.name as assigned_agent_name
     FROM callback_jobs j
     LEFT JOIN agents a ON j.assigned_agent_id = a.id`
  );

  const allPhones = await db.queryAll<{ callback_job_id: number; phone_normalised: string }>(
    `SELECT callback_job_id, phone_normalised FROM callback_job_phones`
  );
  const phonesByJobId = new Map<number, Set<string>>();
  const jobsByPhone = new Map<string, typeof allJobs[0]>();

  for (const p of allPhones) {
    let set = phonesByJobId.get(p.callback_job_id);
    if (!set) {
      set = new Set();
      phonesByJobId.set(p.callback_job_id, set);
    }
    set.add(p.phone_normalised);
  }

  for (const j of allJobs) {
    if (j.client_phone) {
      let set = phonesByJobId.get(j.id);
      if (!set) {
        set = new Set();
        phonesByJobId.set(j.id, set);
      }
      const norm = normalizePhone(j.client_phone);
      if (norm) set.add(norm);
    }
  }

  for (const j of allJobs) {
    const phones = phonesByJobId.get(j.id);
    if (phones) {
      for (const p of phones) {
        if (!jobsByPhone.has(p)) {
          jobsByPhone.set(p, j);
        }
      }
    }
  }

  const jobsByRegAlpha = new Map<string, typeof allJobs[0]>();
  for (const j of allJobs) {
    const r = normalizeRegAlphaNumeric(j.vehicle_reg);
    if (r && !jobsByRegAlpha.has(r)) {
      jobsByRegAlpha.set(r, j);
    }
  }

  const unmatchedList: Array<{
    id: number;
    timestamp: string;
    agent_id: number | null;
    agent_name: string;
    type: string;
    status: string | null;
    target_phone: string;
    reg_no: string | null;
    reason: "NO_JOB_FOR_NUMBER" | "ASSIGNED_TO_OTHER_AGENT" | "UNRECOGNISED_AGENT";
    suggested_job: {
      id: number;
      vehicle_reg: string;
      assigned_agent_id: number | null;
      assigned_agent_name: string | null;
    } | null;
  }> = [];

  for (const ev of candidateEvents) {
    const normPhone = normalizePhone(ev.target_phone);
    const normReg = normalizeRegAlphaNumeric(ev.reg_no);
    const isCall = ev.type === "CALL";
    const isSms = ev.type === "SMS";

    let matched = false;
    for (const j of allJobs) {
      if (j.assigned_agent_id === ev.agent_id) {
        const phones = phonesByJobId.get(j.id);
        const pMatch = Boolean(normPhone && phones && phones.has(normPhone));
        if (isCall && pMatch) {
          matched = true;
          break;
        }
        if (isSms) {
          const rMatch = Boolean(normReg && normReg === normalizeRegAlphaNumeric(j.vehicle_reg));
          if (pMatch || rMatch) {
            matched = true;
            break;
          }
        }
      }
    }

    if (matched) continue;

    let reason: "NO_JOB_FOR_NUMBER" | "ASSIGNED_TO_OTHER_AGENT" | "UNRECOGNISED_AGENT" = "NO_JOB_FOR_NUMBER";
    let suggestedJob: {
      id: number;
      vehicle_reg: string;
      assigned_agent_id: number | null;
      assigned_agent_name: string | null;
    } | null = null;

    if (Boolean(ev.needs_review)) {
      reason = "UNRECOGNISED_AGENT";
      const jobByP = normPhone ? jobsByPhone.get(normPhone) : null;
      const jobByR = normReg ? jobsByRegAlpha.get(normReg) : null;
      const cand = (isSms && jobByR) ? jobByR : (jobByP || jobByR);
      if (cand) {
        suggestedJob = {
          id: cand.id,
          vehicle_reg: cand.vehicle_reg_raw,
          assigned_agent_id: cand.assigned_agent_id,
          assigned_agent_name: cand.assigned_agent_name,
        };
      }
    } else {
      const jobByPhone = normPhone ? jobsByPhone.get(normPhone) : null;
      const jobByReg = normReg ? jobsByRegAlpha.get(normReg) : null;

      if (isSms && jobByReg) {
        reason = "ASSIGNED_TO_OTHER_AGENT";
        suggestedJob = {
          id: jobByReg.id,
          vehicle_reg: jobByReg.vehicle_reg_raw,
          assigned_agent_id: jobByReg.assigned_agent_id,
          assigned_agent_name: jobByReg.assigned_agent_name,
        };
      } else if (jobByPhone) {
        reason = "ASSIGNED_TO_OTHER_AGENT";
        suggestedJob = {
          id: jobByPhone.id,
          vehicle_reg: jobByPhone.vehicle_reg_raw,
          assigned_agent_id: jobByPhone.assigned_agent_id,
          assigned_agent_name: jobByPhone.assigned_agent_name,
        };
      } else {
        reason = "NO_JOB_FOR_NUMBER";
        suggestedJob = null;
      }
    }

    unmatchedList.push({
      id: ev.id,
      timestamp: ev.timestamp,
      agent_id: ev.agent_id,
      agent_name: ev.agent_name,
      type: ev.type,
      status: ev.status,
      target_phone: ev.target_phone,
      reg_no: ev.reg_no,
      reason,
      suggested_job: suggestedJob,
    });
  }

  return unmatchedList;
}


/**
 * Generate grouped Max Attempts Reached report by Channel Partner with merged chronology
 */
export async function getMaxAttemptsReport(db: DbAdapter): Promise<MaxAttemptsReportGroup[]> {
  await closeMaturedCallbackJobs(db);

  // Load allocations once, before the job loop
  const allocations = await db.queryAll<{
    channel_partner: string;
    assigned_agent_id: number | null;
    assigned_agent_name: string | null;
  }>(
    `SELECT cpa.channel_partner, cpa.assigned_agent_id, a.name AS assigned_agent_name
     FROM channel_partner_allocations cpa
     LEFT JOIN agents a ON a.id = cpa.assigned_agent_id`
  );
  const allocationMap = new Map<string, { assigned_agent_id: number | null; assigned_agent_name: string | null }>();
  for (const alloc of allocations) {
    if (alloc.channel_partner) {
      allocationMap.set(alloc.channel_partner.trim().toLowerCase(), {
        assigned_agent_id: alloc.assigned_agent_id ?? null,
        assigned_agent_name: alloc.assigned_agent_name ?? null,
      });
    }
  }

  // Pre-load agents by name for phone mapping in outcome logs
  const agentsByName = await db.queryAll<{ name: string; phone_number: string | null }>(
    `SELECT name, phone_number FROM agents`
  );
  const agentPhoneByName = new Map(agentsByName.map((a) => [a.name, a.phone_number]));

  const jobs = await db.queryAll<{
    id: number;
    vehicle_reg: string;
    vehicle_reg_raw: string;
    client_name: string | null;
    client_phone: string;
    client_phone_raw: string;
    customer_email: string | null;
    channel_partner: string | null;
    initiated_date: string | null;
    first_imported_at: string;
    closed_at: string | null;
    assigned_agent_id: number | null;
    assigned_agent_name: string | null;
  }>(
    `SELECT j.id, j.vehicle_reg, j.vehicle_reg_raw, j.client_name, j.client_phone, j.client_phone_raw, j.customer_email, j.channel_partner, j.initiated_date, j.first_imported_at, j.closed_at, j.assigned_agent_id, a.name as assigned_agent_name
     FROM callback_jobs j
     LEFT JOIN agents a ON j.assigned_agent_id = a.id
     WHERE j.latest_outcome = 'MAX_ATTEMPTS_REACHED'
     ORDER BY j.channel_partner ASC, j.closed_at DESC`
  );

  // Compute counts for the report jobs using computeCallbackJobsActivity
  const metricsMap = await computeCallbackJobsActivity(db, jobs);

  const groupsMap = new Map<string, MaxAttemptsReportRecord[]>();

  for (const job of jobs) {
    const act = metricsMap.get(job.id) || { attempt_count: 0, sms_count: 0, last_attempt_at: null };
    const partner = String(job.channel_partner || "Unassigned Partner").trim() || "Unassigned Partner";
    const alloc = allocationMap.get(partner.toLowerCase());
    const partnerAllocatedAgentId = alloc?.assigned_agent_id ?? null;

    // 1. Fetch outcome logs
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

    const normP = job.client_phone || normalizePhone(job.client_phone_raw);

    // Build distinct non-null agent IDs from [job.assigned_agent_id, partner's allocated_agent_id]
    const candidateAgentIds = Array.from(
      new Set(
        [job.assigned_agent_id, partnerAllocatedAgentId].filter(
          (id): id is number => id !== null && id !== undefined
        )
      )
    );

    let callEvents: Array<{ status: string; timestamp: string; agent_name: string | null; agent_phone: string | null }> = [];
    let smsEvents: Array<{ status: string; timestamp: string; agent_name: string | null; agent_phone: string | null }> = [];

    if (candidateAgentIds.length > 0) {
      const inPlaceholders = candidateAgentIds.map(() => "?").join(", ");

      // 2. Fetch CALL events for this phone matching candidate agent IDs
      callEvents = await db.queryAll<{
        status: string;
        timestamp: string;
        agent_name: string | null;
        agent_phone: string | null;
      }>(
        `SELECT e.status, e.timestamp, a.name as agent_name, a.phone_number as agent_phone
         FROM events e
         JOIN agents a ON e.agent_id = a.id
         WHERE e.type = 'CALL'
           AND (e.target_phone = ? OR e.target_phone LIKE ?)
           AND a.id IN (${inPlaceholders})`,
        [normP, `%${normP}%`, ...candidateAgentIds]
      );

      // 3. Fetch SMS events for this phone matching candidate agent IDs
      smsEvents = await db.queryAll<{
        status: string;
        timestamp: string;
        agent_name: string | null;
        agent_phone: string | null;
      }>(
        `SELECT e.status, e.timestamp, a.name as agent_name, a.phone_number as agent_phone
         FROM events e
         JOIN agents a ON e.agent_id = a.id
         WHERE e.type = 'SMS'
           AND (e.target_phone = ? OR e.target_phone LIKE ?)
           AND a.id IN (${inPlaceholders})`,
        [normP, `%${normP}%`, ...candidateAgentIds]
      );
    }

    // 5. Build the merged chronological trail with counted flag
    const chronology: MaxAttemptsChronologyEntry[] = [
      ...rawLogs.map((l) => ({
        kind: "OUTCOME" as const,
        outcome: l.outcome,
        comment: l.comment || "",
        logged_by: l.logged_by,
        logged_by_phone: agentPhoneByName.get(l.logged_by) || null,
        timestamp: l.created_at,
        counted: false,
      })),
      ...callEvents.map((c) => ({
        kind: "CALL" as const,
        status: c.status || "OUTGOING",
        logged_by: c.agent_name || "Unknown",
        logged_by_phone: c.agent_phone || null,
        timestamp: c.timestamp,
        counted: String(c.status || "").toUpperCase() === "OUTGOING",
      })),
      ...smsEvents.map((s) => ({
        kind: "SMS" as const,
        status: s.status || "SENT",
        note: "SMS follow-up dispatched",
        logged_by: s.agent_name || "System",
        logged_by_phone: s.agent_phone || null,
        timestamp: s.timestamp,
        counted: true,
      })),
    ];

    chronology.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const record: MaxAttemptsReportRecord = {
      vehicle_reg_raw: job.vehicle_reg_raw,
      client_name: job.client_name,
      client_phone_raw: job.client_phone_raw,
      customer_email: job.customer_email || null,
      initiated_date: job.initiated_date,
      closed_at: job.closed_at,
      assigned_agent_id: job.assigned_agent_id,
      assigned_agent_name: job.assigned_agent_name,
      outgoing_calls_count: act.attempt_count,
      sms_count: act.sms_count,
      attempts,
      chronology,
    };

    if (!groupsMap.has(partner)) {
      groupsMap.set(partner, []);
    }
    groupsMap.get(partner)!.push(record);
  }

  const result: MaxAttemptsReportGroup[] = [];
  for (const [partner, records] of groupsMap.entries()) {
    const alloc = allocationMap.get(partner.toLowerCase());
    result.push({
      channel_partner: partner,
      allocated_agent_id: alloc?.assigned_agent_id ?? null,
      allocated_agent_name: alloc?.assigned_agent_name ?? null,
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

export {
  planClosureReopen,
  runOneTimeClosureReopen,
  CLOSURE_REOPEN_JOB_KEY,
} from "./closureReopenJob";

export type {
  ClosureReopenAction,
  ClosureReopenJobInput,
  ClosureReopenDecision,
} from "./closureReopenJob";
