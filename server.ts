import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { initDatabase, getDb, getPostgresPool } from "./db";
import { getSystemSettings, updateSystemSettings, getSettingsChangeLogs } from "./settingsManager";
import { evaluateCompliance, RawEvent, RawAgent } from "./complianceEngine";
import { clearAdminSession, requireAdmin, requireAuth, sessionRole, setUserSession } from './server/auth/adminSession';
import { clearEmailMemberSession, emailMember } from './server/auth/emailMemberSession';
import { beginMicrosoftEmailLogin, completeMicrosoftEmailLogin, microsoftEmailLoginAvailable } from './server/auth/microsoftEmailLogin';
import { createEmailRouter } from './server/email/emailRoutes';
import { configuredEmailRuntime, startEmailPolling } from './server/email/emailSyncService';
import {
  getCallbackSettings,
  updateCallbackSettings,
  importCallbackJobs,
  getCallbackJobs,
  updateCallbackJobStatus,
  logCallbackOutcome,
  getCallbackJobLogs,
  closeMaturedCallbackJobs,
  getMaxAttemptsReport,
  seedChannelPartnerAllocations,
  getChannelPartnerAllocations,
  setChannelPartnerAllocation,
} from "./insuranceCallbacks";
import * as XLSX from "xlsx";
import { seedDefaultAdmin, hashPassword, verifyPassword } from "./auth";

// SSE Clients for real-time agent name push
const agentClients = new Map<number, any>();

async function startServer() {
  const app = express();
  // Browser access is same-origin by default. Native Android requests are not
  // affected by CORS, which is a browser policy.
  const allowedOrigins = new Set((process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json());

  const PORT = Number(process.env.PORT || 3000);

  // PostgreSQL only. Schema changes are applied by `npm run db:migrate`.
  const db = await initDatabase();
  console.log(`[DB] Engine active: ${db.type.toUpperCase()} - ${db.statusMessage}`);

  // Ensure default system settings exist
  await getSystemSettings(db);

  // Seed channel-partner → agent allocations for the callbacks feature
  await seedChannelPartnerAllocations(db);

  // Seed the initial admin user (from ADMIN_USERNAME/ADMIN_PASSWORD) if none exists
  await seedDefaultAdmin(db);

  const emailRuntime = configuredEmailRuntime();
  if (emailRuntime) {
    const migration = await db.queryOne('SELECT version FROM schema_migrations WHERE version = 18');
    if (!migration) throw new Error('Email SLA requires database migration 018 before it can be enabled');
    startEmailPolling(emailRuntime);
  }
  app.use('/api/email', createEmailRouter(emailRuntime));
  app.get('/api/email-auth/start', (req, res) => {
    if (!emailRuntime) return res.status(503).send('Email SLA is not enabled');
    beginMicrosoftEmailLogin(req, res);
  });
  app.get('/api/email-auth/callback', (req, res) => {
    if (!emailRuntime) return res.redirect('/?emailAuthError=disabled');
    void completeMicrosoftEmailLogin(req, res);
  });

  // --- API Routes ---

  // Database Status & Diagnostics Endpoint
  app.get("/api/db-status", (req, res) => {
    res.json({
      type: db.type,
      isMysqlConnected: false,
      isConnected: db.isConnected,
      statusMessage: db.statusMessage,
      database: "PostgreSQL",
    });
  });

  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

  // Admin Login — validates against the users table, then sets the admin session
  // cookie (unchanged session mechanism, so Email SLA / cs_member auth is untouched).
  app.post("/api/login", async (req, res) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const current = loginAttempts.get(key);
    const attempt = current && current.resetAt > now ? current : { count: 0, resetAt: now + 15 * 60_000 };
    if (attempt.count >= 30) return res.status(429).json({ error: 'Too many login attempts' });

    try {
      const { username, password } = req.body || {};
      const submittedUser = (username || "").trim();
      const submittedPass = (password || "").trim();
      if (!submittedUser || !submittedPass) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const user = await db.queryOne<{ id: number; username: string; password_hash: string; display_name: string; active: any; role: string }>(
        `SELECT id, username, password_hash, display_name, active, role FROM users WHERE LOWER(username) = LOWER(?)`,
        [submittedUser]
      );
      const isActive = user && (user.active === true || user.active === 1);
      const isValid = isActive ? await verifyPassword(submittedPass, user!.password_hash) : false;

      if (!isValid) {
        attempt.count++;
        loginAttempts.set(key, attempt);
        return res.status(401).json({ error: "Invalid credentials or inactive account" });
      }

      const role = user!.role === 'callback_agent' ? 'callback_agent' : 'admin';
      loginAttempts.delete(key);
      setUserSession(req, res, role);
      res.json({ success: true, role, display_name: user!.display_name });
    } catch (err) {
      console.error("[AUTH] Login error:", err);
      res.status(500).json({ error: "Authentication failed" });
    }
  });

  app.get('/api/session', async (req, res) => {
    const role = sessionRole(req);
    if (role) return res.json({ authenticated: true, role, emailLoginAvailable: Boolean(emailRuntime) && microsoftEmailLoginAvailable() });
    const email = emailMember(req);
    if (emailRuntime && email && emailRuntime.mailboxes.includes(email)) {
      try {
        const member = await getPostgresPool().query('SELECT 1 FROM email_team_members WHERE email=$1 AND is_monitored=true', [email]);
        if (member.rowCount) return res.json({ authenticated: true, role: 'cs_member', email, emailLoginAvailable: true });
      } catch (error) {
        console.error('[EMAIL] Could not verify CS member session:', (error as Error).message);
        return res.status(503).json({ error: 'Session verification unavailable' });
      }
    }
    res.json({ authenticated: false, role: null, emailLoginAvailable: Boolean(emailRuntime) && microsoftEmailLoginAvailable() });
  });
  app.post('/api/logout', (req, res) => { clearAdminSession(req, res); clearEmailMemberSession(req, res); res.json({ success: true }); });

  // GET /api/users - returns all accounts omitting password_hash
  app.get("/api/users", requireAdmin, async (req, res) => {
    try {
      const users = await db.queryAll<{ id: number; username: string; display_name: string; active: any; role: string; created_at: string }>(
        `SELECT id, username, display_name, active, role, created_at FROM users ORDER BY id ASC`
      );
      const normalized = users.map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        active: Boolean(u.active),
        role: u.role === 'callback_agent' ? 'callback_agent' : 'admin',
        created_at: u.created_at,
      }));
      res.json(normalized);
    } catch (err) {
      console.error("[API] Error fetching users:", err);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // POST /api/users - creates an account
  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, display_name, password, role } = req.body || {};
      const cleanUser = (username || "").trim();
      const cleanName = (display_name || "").trim() || cleanUser;
      const cleanPass = (password || "").trim();
      // New accounts default to the restricted callback_agent role.
      const cleanRole = role === 'admin' ? 'admin' : 'callback_agent';

      if (!cleanUser || !cleanPass) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const existing = await db.queryOne<{ id: number }>(
        `SELECT id FROM users WHERE LOWER(username) = LOWER(?)`,
        [cleanUser]
      );
      if (existing) {
        return res.status(409).json({ error: `Username "${cleanUser}" already exists` });
      }

      const passwordHash = await hashPassword(cleanPass);
      const result = await db.execute(
        `INSERT INTO users (username, password_hash, display_name, active, role, created_at, updated_at)
         VALUES (?, ?, ?, TRUE, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [cleanUser, passwordHash, cleanName, cleanRole]
      );

      res.status(201).json({
        id: result.lastInsertId,
        username: cleanUser,
        display_name: cleanName,
        active: true,
        role: cleanRole,
      });
    } catch (err) {
      console.error("[API] Error creating user:", err);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // PATCH /api/users/:id - updates display_name and/or active flag
  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { display_name, active, role } = req.body || {};

      const user = await db.queryOne<{ id: number }>(`SELECT id FROM users WHERE id = ?`, [id]);
      if (!user) return res.status(404).json({ error: "User not found" });

      const updates: string[] = [];
      const params: any[] = [];

      if (display_name !== undefined) {
        updates.push("display_name = ?");
        params.push(String(display_name).trim());
      }
      if (active !== undefined) {
        updates.push("active = ?");
        params.push(active ? true : false);
      }
      if (role !== undefined) {
        updates.push("role = ?");
        params.push(role === 'admin' ? 'admin' : 'callback_agent');
      }

      if (updates.length > 0) {
        updates.push("updated_at = CURRENT_TIMESTAMP");
        params.push(id);
        await db.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
      }

      const updated = await db.queryOne<{ id: number; username: string; display_name: string; active: any; role: string; created_at: string }>(
        `SELECT id, username, display_name, active, role, created_at FROM users WHERE id = ?`,
        [id]
      );
      res.json({
        ...updated,
        active: Boolean(updated?.active),
        role: updated?.role === 'callback_agent' ? 'callback_agent' : 'admin',
      });
    } catch (err) {
      console.error("[API] Error updating user:", err);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // POST /api/users/:id/reset-password - sets a new password
  app.post("/api/users/:id/reset-password", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { new_password } = req.body || {};
      const cleanPass = (new_password || "").trim();

      if (!cleanPass) {
        return res.status(400).json({ error: "New password is required" });
      }

      const user = await db.queryOne<{ id: number }>(`SELECT id FROM users WHERE id = ?`, [id]);
      if (!user) return res.status(404).json({ error: "User not found" });

      const passwordHash = await hashPassword(cleanPass);
      await db.execute(
        `UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [passwordHash, id]
      );

      res.json({ success: true, message: "Password updated successfully" });
    } catch (err) {
      console.error("[API] Error resetting password:", err);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Log Installation / Heartbeat
  app.post("/api/log-agent", async (req, res) => {
    const { name, agentName, agent_name, phone_number } = req.body;
    const finalName = (name || agentName || agent_name || "").trim();

    if (!finalName) return res.status(400).json({ error: "Name is required" });

    try {
      await db.execute(
          `INSERT INTO agents (name, phone_number, last_active_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(name) DO UPDATE SET
             phone_number = COALESCE(excluded.phone_number, agents.phone_number),
             last_active_at = CURRENT_TIMESTAMP`,
          [finalName, phone_number || null]
        );

      const agent = await db.queryOne("SELECT * FROM agents WHERE name = ?", [finalName]);
      res.json({ success: true, agent_id: agent?.id });
    } catch (err) {
      console.error("[API] Error in log-agent:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Log Call/SMS Event
  app.post("/api/log-event", async (req, res) => {
    const {
      agent_name,
      agentName,
      agent_id,
      agentId,
      type,
      target_phone,
      targetPhone,
      phoneNumber,
      phone_number,
      status,
      duration,
      reg_no,
      regNo,
    } = req.body;

    let name = (agent_name || agentName || "Unknown Agent").trim();
    if (!name || name.toLowerCase() === "agent") name = "Unknown Agent";

    const rawTargetPhone = (target_phone || targetPhone || phoneNumber || phone_number || "Unknown").trim();
    const finalTargetPhone = rawTargetPhone.replace(/[^\d+]/g, "");
    const finalRegNo = (reg_no || regNo || "").trim();
    const finalDuration = typeof duration === "number" ? Math.max(0, Math.floor(duration)) : 0;

    console.log(`[API] Event received: ${type} from "${name}" to ${finalTargetPhone} (${status}, dur=${finalDuration}s)`);

    try {
      // Check if target phone is an internal contact
      const isInternal = await db.queryOne("SELECT 1 FROM internal_contacts WHERE phone_number = ?", [
        finalTargetPhone,
      ]);
      if (isInternal) {
        console.log(`[API] Skipping event for internal contact: ${finalTargetPhone}`);
        return res.json({ success: true, skipped: true });
      }

      // 1. Ensure "Unknown Agent" exists
      try {
        await db.execute("INSERT INTO agents (name) VALUES ('Unknown Agent') ON CONFLICT (name) DO NOTHING");
      } catch (e) {
        // Ignore if exists
      }

      // 2. Prefer the stable ID supplied by configured Android devices. Name lookup
      // remains supported for older app versions during the transition.
      const requestedAgentId = Number(agent_id || agentId || 0);
      let agent = Number.isInteger(requestedAgentId) && requestedAgentId > 0
        ? await db.queryOne("SELECT id, archived_at FROM agents WHERE id = ?", [requestedAgentId])
        : null;

      if (!agent) {
        agent = await db.queryOne("SELECT id, archived_at FROM agents WHERE name = ?", [name]);
      }

      // Archived agents retain their history but must not create future activity.
      if (agent?.archived_at) {
        console.log(`[API] Skipping event for archived agent: ${name} (${agent.id})`);
        return res.json({ success: true, skipped: true, reason: "agent_archived" });
      }

      // 3. Auto-create agent if not found
      if (!agent && name !== "Unknown Agent") {
        console.log(`[API] Agent "${name}" not found. Auto-creating...`);
        try {
          const result = await db.execute("INSERT INTO agents (name) VALUES (?)", [name]);
          agent = { id: result.lastInsertId };
        } catch (insertErr) {
          agent = await db.queryOne("SELECT id FROM agents WHERE name = ?", [name]);
        }
      }

      // 4. Fallback to Unknown Agent
      if (!agent) {
        agent = await db.queryOne("SELECT id FROM agents WHERE name = 'Unknown Agent'");
      }

      const resolvedAgentId = agent?.id || null;

      const result = await db.execute(
        `INSERT INTO events (agent_id, type, target_phone, status, duration, reg_no)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [resolvedAgentId, type, finalTargetPhone, status, finalDuration, finalRegNo]
      );

      // Update agent heartbeat
      if (resolvedAgentId) {
        await db.execute("UPDATE agents SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?", [resolvedAgentId]);
      }

      res.json({ success: true, id: result.lastInsertId });
    } catch (err) {
      console.error("[API] Database error in log-event:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Update Agent Tag
  app.post("/api/update-agent-tag", requireAdmin, async (req, res) => {
    const { id, tag } = req.body;
    if (!id || tag === undefined) return res.status(400).json({ error: "ID and Tag are required" });

    try {
      await db.execute("UPDATE agents SET tag = ? WHERE id = ?", [tag, id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Update Agent Name (and push to device)
  app.post("/api/update-agent-name", requireAdmin, async (req, res) => {
    const { id, name } = req.body;
    const finalName = (name || "").trim();
    if (!id || !finalName) return res.status(400).json({ error: "ID and Name are required" });

    try {
      await db.execute("UPDATE agents SET name = ? WHERE id = ?", [finalName, id]);

      // Notify client via SSE if connected
      const client = agentClients.get(Number(id));
      if (client) {
        client.write(`data: ${JSON.stringify({ type: "name_update", name: finalName })}\n\n`);
      }

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      if ((err as any)?.code === "23505") {
        return res.status(409).json({ error: "Another agent already uses that name" });
      }
      res.status(500).json({ error: "Database error" });
    }
  });

  // Archive/reactivate agents without deleting their events or SLA history.
  app.post("/api/agents/:id/archive", requireAdmin, async (req, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Archive reason is required" });
    if (reason.length > 500) return res.status(400).json({ error: "Archive reason must be 500 characters or fewer" });
    try {
      const result = await db.execute(
        "UPDATE agents SET archived_at = CURRENT_TIMESTAMP, archive_reason = ? WHERE id = ? AND name != 'Unknown Agent' AND archived_at IS NULL",
        [reason, req.params.id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: "Active agent not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("[API] Unable to archive agent:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.post("/api/agents/:id/reactivate", requireAdmin, async (req, res) => {
    try {
      const result = await db.execute(
        "UPDATE agents SET archived_at = NULL, last_active_at = CURRENT_TIMESTAMP WHERE id = ? AND name != 'Unknown Agent' AND archived_at IS NOT NULL",
        [req.params.id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: "Archived agent not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("[API] Unable to reactivate agent:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.get("/api/archived-agents", requireAdmin, async (_req, res) => {
    try {
      const agents = await db.queryAll(
        `SELECT a.id, a.name, a.phone_number, a.tag, a.archived_at, a.archive_reason, COUNT(e.id)::int AS event_count
         FROM agents a
         LEFT JOIN events e ON e.agent_id = a.id
         WHERE a.archived_at IS NOT NULL
         GROUP BY a.id, a.name, a.phone_number, a.tag, a.archived_at, a.archive_reason
         ORDER BY a.archived_at DESC`
      );
      res.json(agents);
    } catch (err) {
      console.error("[API] Unable to list archived agents:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // SSE Endpoint for Agent Updates
  app.get("/api/agent-updates/:id", (req, res) => {
    const id = Number(req.params.id);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    agentClients.set(id, res);
    console.log(`[SSE] Agent ${id} connected`);

    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    req.on("close", () => {
      agentClients.delete(id);
      console.log(`[SSE] Agent ${id} disconnected`);
    });
  });

  // Device configuration: the app uses this instead of local hardcoded names/templates.
  app.get("/api/app-config/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "A valid agent ID is required" });
    }

    try {
      const agent = await db.queryOne("SELECT id, name FROM agents WHERE id = ?", [id]);
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      const settings = await getSystemSettings(db);
      res.json({
        agent_id: agent.id,
        agent_name: agent.name,
        sms_template: settings.sms_template,
        sms_followup_enabled: settings.sms_followup_enabled,
      });
    } catch (err) {
      console.error("[API] Error fetching app configuration:", err);
      res.status(500).json({ error: "Failed to fetch app configuration" });
    }
  });

  // Master System Settings API
  app.get("/api/settings", requireAdmin, async (req, res) => {
    try {
      const settings = await getSystemSettings(db);
      const changeLogs = await getSettingsChangeLogs(db);
      res.json({ settings, change_logs: changeLogs });
    } catch (err) {
      console.error("[API] Error fetching settings:", err);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", requireAdmin, async (req, res) => {
    const { settings, changed_by } = req.body || {};
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ error: "Settings object is required" });
    }
    if (settings.sms_followup_enabled && !String(settings.sms_template || "").trim()) {
      return res.status(400).json({ error: "SMS template is required when SMS follow-up is enabled" });
    }
    if (settings.sms_template !== undefined && String(settings.sms_template).length > 1000) {
      return res.status(400).json({ error: "SMS template must be 1000 characters or fewer" });
    }

    try {
      const result = await updateSystemSettings(db, settings, changed_by || "Admin");
      const changeLogs = await getSettingsChangeLogs(db);
      res.json({ success: true, settings: result.settings, change_logs: changeLogs });
    } catch (err) {
      console.error("[API] Error updating settings:", err);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

// Helper function to reliably aggregate activity stats from events
function computeActivitySummary(events: any[], totalAgents: number = 0) {
  let total_sms = 0;
  let total_calls_made = 0;
  let total_calls_incoming = 0;
  let total_calls_incoming_connected = 0;
  let total_calls_missed = 0;

  const outgoingByPhone = new Map<string, number[]>(); // timestamps of OUTGOING events, unmatched so far
  const connectedByPhone = new Map<string, number[]>(); // timestamps of CONNECTED events, unmatched so far

  for (const e of events) {
    const type = (e.type || "").toUpperCase();
    const status = (e.status || "").toUpperCase();
    const phone = e.target_phone;
    const ts = new Date(e.timestamp).getTime();

    if (type === "SMS") {
      total_sms += 1;
      continue;
    }
    if (type !== "CALL") continue;

    if (status === "MISSED") {
      total_calls_missed += 1;
      total_calls_incoming += 1;
    } else if (status === "INCOMING") {
      total_calls_incoming += 1;
      total_calls_incoming_connected += 1; // INCOMING already means answered, no correlation needed
    } else if (status === "OUTGOING") {
      total_calls_made += 1; // one dial attempt, counted exactly once, regardless of outcome
      const list = outgoingByPhone.get(phone) || [];
      list.push(ts);
      outgoingByPhone.set(phone, list);
    } else if (status === "CONNECTED") {
      const list = connectedByPhone.get(phone) || [];
      list.push(ts);
      connectedByPhone.set(phone, list);
    } else if (["NOT_PICKED", "FAILED", "BUSY", "NO_ANSWER"].includes(status)) {
      total_calls_made += 1;
    }
  }

  // Match each outgoing attempt to its own CONNECTED companion, fired back-to-back
  // on the device, not thirty minutes later, so a short window is what's correct here.
  const SHORT_WINDOW_MS = 5 * 60 * 1000;
  let total_calls_outgoing_connected = 0;

  for (const [phone, outTimestamps] of outgoingByPhone) {
    const connTimestamps = [...(connectedByPhone.get(phone) || [])];
    for (const outTs of outTimestamps) {
      const matchIdx = connTimestamps.findIndex(
        (cTs) => cTs >= outTs && cTs - outTs <= SHORT_WINDOW_MS
      );
      if (matchIdx !== -1) {
        total_calls_outgoing_connected += 1;
        connTimestamps.splice(matchIdx, 1);
      }
    }
  }

  const total_calls_not_picked = total_calls_made - total_calls_outgoing_connected;
  const total_calls_connected = total_calls_incoming_connected + total_calls_outgoing_connected;

  return {
    total_agents: totalAgents,
    total_sms,
    total_calls_made,
    total_calls_incoming,
    total_calls_connected,
    total_calls_outgoing_connected,
    total_calls_incoming_connected,
    total_calls_not_picked,
    total_calls_missed,
  };
}

  // Global Activity Summary Stats & Legacy Endpoint
  app.get("/api/stats", requireAdmin, async (req, res) => {
    const { startDate, endDate, agentId, tag } = req.query;
    const now = new Date();
    const nairobiOffset = 3 * 60 * 60 * 1000;
    const nairobiDate = new Date(now.getTime() + nairobiOffset).toISOString().split("T")[0];

    const start = (startDate as string) || nairobiDate;
    const end = (endDate as string) || start;
    const filterAgentId = agentId ? Number(agentId) : null;
    const filterTag = tag as string;

    try {
      let eventsQuery = `
        SELECT e.id, e.agent_id, e.type, e.target_phone, e.status, COALESCE(e.duration, 0) as duration, e.reg_no,
               e.timestamp, datetime(e.timestamp, '+3 hours') as local_timestamp,
               COALESCE(a.name, 'Unknown Agent') as agent_name
        FROM events e
        LEFT JOIN agents a ON e.agent_id = a.id
        WHERE date(e.timestamp, '+3 hours') BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM internal_contacts ic WHERE ic.phone_number = e.target_phone)
      `;
      const eventsParams: any[] = [start, end];

      if (filterAgentId) {
        eventsQuery += " AND e.agent_id = ?";
        eventsParams.push(filterAgentId);
      }
      if (filterTag) {
        eventsQuery += " AND a.tag = ?";
        eventsParams.push(filterTag);
      }
      eventsQuery += " ORDER BY e.timestamp ASC";

      const events = await db.queryAll(eventsQuery, eventsParams);
      const allAgentsList = await db.queryAll(
        `SELECT id, name, tag, archived_at FROM agents
         WHERE name != 'Unknown Agent'
         AND (archived_at IS NULL OR EXISTS (
           SELECT 1 FROM events historical_event
           WHERE historical_event.agent_id = agents.id
           AND date(historical_event.timestamp, '+3 hours') BETWEEN ? AND ?
         ))
         ORDER BY name ASC`,
        [start, end]
      );
      const summary = computeActivitySummary(events, allAgentsList.length);

      res.json({
        summary,
        raw_summary: summary,
        allAgents: allAgentsList,
        db_type: db.type,
      });
    } catch (err) {
      console.error("[API] stats error:", err);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Comprehensive Compliance Stats Endpoint
  app.get("/api/compliance-stats", requireAdmin, async (req, res) => {
    const { startDate, endDate, agentId, tag } = req.query;

    const now = new Date();
    const nairobiOffset = 3 * 60 * 60 * 1000;
    const nairobiDate = new Date(now.getTime() + nairobiOffset).toISOString().split("T")[0];

    const start = (startDate as string) || nairobiDate;
    const end = (endDate as string) || start;
    const filterAgentId = agentId ? Number(agentId) : null;
    const filterTag = tag as string;

    try {
      // 1. Fetch live system settings
      const settings = await getSystemSettings(db);

      // 2. Fetch all agents
      let agentsQuery = `SELECT id, name, phone_number, tag, installed_at, last_active_at, archived_at
        FROM agents
        WHERE name != 'Unknown Agent'
        AND (archived_at IS NULL OR EXISTS (
          SELECT 1 FROM events historical_event
          WHERE historical_event.agent_id = agents.id
          AND date(historical_event.timestamp, '+3 hours') BETWEEN ? AND ?
        ))`;
      const agentsParams: any[] = [start, end];
      if (filterAgentId) {
        agentsQuery += " AND id = ?";
        agentsParams.push(filterAgentId);
      }
      if (filterTag) {
        agentsQuery += " AND tag = ?";
        agentsParams.push(filterTag);
      }
      agentsQuery += " ORDER BY name ASC";
      const agents: RawAgent[] = await db.queryAll(agentsQuery, agentsParams);

      // 3. Fetch events in date range (excluding internal contacts)
      let eventsQuery = `
        SELECT e.id, e.agent_id, e.type, e.target_phone, e.status, COALESCE(e.duration, 0) as duration, e.reg_no,
               e.timestamp, datetime(e.timestamp, '+3 hours') as local_timestamp,
               COALESCE(a.name, 'Unknown Agent') as agent_name
        FROM events e
        LEFT JOIN agents a ON e.agent_id = a.id
        WHERE date(e.timestamp, '+3 hours') BETWEEN ? AND ?
        AND e.target_phone NOT IN (SELECT phone_number FROM internal_contacts)
      `;
      const eventsParams: any[] = [start, end];

      if (filterAgentId) {
        eventsQuery += " AND e.agent_id = ?";
        eventsParams.push(filterAgentId);
      }
      if (filterTag) {
        eventsQuery += " AND a.tag = ?";
        eventsParams.push(filterTag);
      }
      eventsQuery += " ORDER BY e.timestamp ASC";

      const events: RawEvent[] = await db.queryAll(eventsQuery, eventsParams);

      // 4. Run Compliance Engine
      const complianceResult = evaluateCompliance(events, agents, settings, new Date());

      // 5. Activity Summary
      const allAgentsList = await db.queryAll(
        `SELECT id, name, tag, archived_at FROM agents
         WHERE name != 'Unknown Agent'
         AND (archived_at IS NULL OR EXISTS (
           SELECT 1 FROM events historical_event
           WHERE historical_event.agent_id = agents.id
           AND date(historical_event.timestamp, '+3 hours') BETWEEN ? AND ?
         ))
         ORDER BY name ASC`,
        [start, end]
      );
      const summary = computeActivitySummary(events, allAgentsList.length);

      // 6. Recent events with compliance labels (last 100)
      const recentEvents = [...events].reverse().slice(0, 100).map((ev) => {
        const label = complianceResult.complianceLabels.get(ev.id);
        return {
          ...ev,
          compliance_effect: label?.effect || null,
          compliance_note: label?.note || null,
        };
      });

      // Populate raw activity stats in agent summaries
      Object.values(complianceResult.agentSummaries).forEach((agentSum) => {
        const agentEvents = events.filter((e) => e.agent_id === agentSum.agent_id);
        const aStats = computeActivitySummary(agentEvents, 1);
        agentSum.calls_made = aStats.total_calls_made;
        agentSum.calls_incoming = aStats.total_calls_incoming;
        agentSum.calls_connected = aStats.total_calls_connected;
        agentSum.calls_outgoing_connected = aStats.total_calls_outgoing_connected;
        agentSum.calls_incoming_connected = aStats.total_calls_incoming_connected;
        agentSum.calls_not_picked = aStats.total_calls_not_picked;
        agentSum.calls_missed = aStats.total_calls_missed;
        agentSum.sms_count = aStats.total_sms;
      });

      res.json({
        summary,
        raw_summary: summary,
        headline_stats: complianceResult.headlineStats,
        agents: Object.values(complianceResult.agentSummaries),
        agent_summaries: Object.values(complianceResult.agentSummaries),
        tag_groups: Object.values(complianceResult.tagSummaries),
        tag_summaries: complianceResult.tagSummaries,
        turnaround_report: complianceResult.turnaroundReport,
        open_obligations: complianceResult.actionableCallbackList,
        actionable_callback_list: complianceResult.actionableCallbackList,
        all_obligations: complianceResult.allObligations,
        all_events: events,
        recent_events: recentEvents,
        settings,
        startDate: start,
        endDate: end,
        allAgents: allAgentsList,
        db_type: db.type,
      });
    } catch (err) {
      console.error("[API] compliance-stats error:", err);
      res.status(500).json({ error: "Failed to compute compliance stats" });
    }
  });

  // Search Contacts (Flexibly matching phone numbers)
  app.get("/api/search-contacts", requireAdmin, async (req, res) => {
    const { query } = req.query;
    if (!query || typeof query !== "string") {
      return res.json([]);
    }

    const cleanQuery = query.replace(/[^\d+]/g, "").trim();
    if (!cleanQuery) return res.json([]);

    try {
      const results = await db.queryAll(
        `SELECT e.target_phone,
                COUNT(*) as event_count,
                MAX(e.timestamp) as last_event_at,
                datetime(MAX(e.timestamp), '+3 hours') as last_event_local,
                (SELECT a.name FROM events e2 LEFT JOIN agents a ON e2.agent_id = a.id WHERE e2.target_phone = e.target_phone ORDER BY e2.timestamp DESC LIMIT 1) as last_agent_name
         FROM events e
         WHERE (e.target_phone LIKE ? OR e.target_phone LIKE ?)
         AND e.target_phone NOT IN (SELECT phone_number FROM internal_contacts)
         GROUP BY e.target_phone
         ORDER BY last_event_at DESC
         LIMIT 20`,
        [`%${cleanQuery}%`, `%${cleanQuery.replace(/^\+/, "")}%`]
      );
      res.json(results);
    } catch (err) {
      console.error("[API] search-contacts error:", err);
      res.status(500).json({ error: "Failed to search contacts" });
    }
  });

  // Get Contact History & Thread Compliance Verdicts
  app.get("/api/contact-history", requireAdmin, async (req, res) => {
    const { phone } = req.query;
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const cleanPhone = phone.replace(/[^\d+]/g, "").trim();
    const withoutPlus = cleanPhone.replace(/^\+/, "");
    const localFormat = withoutPlus.startsWith("254") ? "0" + withoutPlus.substring(3) : withoutPlus;

    try {
      const settings = await getSystemSettings(db);

      // Fetch all events matching variations of this phone number
      const historyEvents: RawEvent[] = await db.queryAll(
        `SELECT e.id, e.agent_id, e.type, e.target_phone, e.status, COALESCE(e.duration, 0) as duration, e.reg_no,
                e.timestamp, datetime(e.timestamp, '+3 hours') as local_timestamp,
                COALESCE(a.name, 'Unknown Agent') as agent_name,
                COALESCE(a.tag, 'Uncategorised') as agent_tag
         FROM events e
         LEFT JOIN agents a ON e.agent_id = a.id
         WHERE e.target_phone IN (?, ?, ?, ?)
         ORDER BY e.timestamp ASC`,
        [cleanPhone, withoutPlus, `+${withoutPlus}`, localFormat]
      );

      const allAgents: RawAgent[] = await db.queryAll("SELECT id, name, tag FROM agents");

      // Run compliance evaluation on this number's history
      const complianceResult = evaluateCompliance(historyEvents, allAgents, settings, new Date());

      // Chronological timeline (oldest to newest) with compliance tagging
      const timeline = historyEvents.map((ev) => {
        const label = complianceResult.complianceLabels.get(ev.id);
        return {
          ...ev,
          compliance_effect: label?.effect || null,
          compliance_note: label?.note || null,
        };
      });

      // Filter obligations generated by this contact thread
      const obligationsSummary = complianceResult.allObligations.filter((obl) => {
        const norm = obl.target_phone.replace(/[^\d]/g, "");
        const targetNorm = cleanPhone.replace(/[^\d]/g, "");
        return norm.includes(targetNorm) || targetNorm.includes(norm);
      });

      res.json({
        phone: cleanPhone,
        total_events: historyEvents.length,
        timeline,
        obligations_summary: obligationsSummary,
        settings,
      });
    } catch (err) {
      console.error("[API] contact-history error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });





  // Events Detail
  app.get("/api/events-detail", requireAdmin, async (req, res) => {
    const { agent_id, type, status, startDate, endDate } = req.query;
    const start = (startDate as string) || new Date().toISOString().split("T")[0];
    const end = (endDate as string) || start;

    try {
      let query = `
        SELECT e.*, a.name as agent_name, datetime(e.timestamp, '+3 hours') as local_timestamp
        FROM events e
        LEFT JOIN agents a ON e.agent_id = a.id
        WHERE date(e.timestamp, '+3 hours') BETWEEN ? AND ?
      `;
      const params: any[] = [start, end];

      if (agent_id) {
        query += ` AND e.agent_id = ?`;
        params.push(agent_id);
      }
      if (type) {
        query += ` AND e.type = ?`;
        params.push(type);
      }
      if (status) {
        if (status === "FAILED_ALL") {
          query += ` AND e.status IN ('FAILED', 'BUSY', 'NO_ANSWER')`;
        } else if (status === "OUTGOING_CONNECTED") {
          query += ` AND e.status = 'CONNECTED' AND EXISTS (
            SELECT 1 FROM events e2 
            WHERE e2.agent_id = e.agent_id 
            AND e2.type = 'CALL' 
            AND e2.status IN ('OUTGOING', 'FAILED', 'BUSY', 'NO_ANSWER')
            AND e2.target_phone = e.target_phone 
            AND ABS(strftime('%s', e2.timestamp) - strftime('%s', e.timestamp)) < 120
          )`;
        } else if (status === "INCOMING_CONNECTED") {
          query += ` AND e.status = 'CONNECTED' AND EXISTS (
            SELECT 1 FROM events e2 
            WHERE e2.agent_id = e.agent_id 
            AND e2.type = 'CALL' 
            AND e2.status = 'INCOMING' 
            AND e2.target_phone = e.target_phone 
            AND ABS(strftime('%s', e2.timestamp) - strftime('%s', e.timestamp)) < 120
          )`;
        } else if (status === "NOT_PICKED") {
          query += ` AND e.status = 'OUTGOING' AND NOT EXISTS (
            SELECT 1 FROM events e2 
            WHERE e2.agent_id = e.agent_id 
            AND e2.type = 'CALL' 
            AND e2.status = 'CONNECTED' 
            AND e2.target_phone = e.target_phone
            AND ABS(strftime('%s', e2.timestamp) - strftime('%s', e.timestamp)) < 60
          )`;
        } else if (status === "MISSED") {
          query += ` AND e.status = 'MISSED' AND NOT EXISTS (
            SELECT 1 FROM events e2 
            WHERE e2.agent_id = e.agent_id 
            AND e2.type = 'CALL' 
            AND e2.status = 'OUTGOING' 
            AND e2.target_phone = e.target_phone
            AND e2.timestamp > e.timestamp
          )`;
        } else {
          query += ` AND e.status = ?`;
          params.push(status);
        }
      }

      query += ` ORDER BY e.timestamp DESC`;
      const events = await db.queryAll(query, params);
      res.json(events);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Internal Contacts API
  app.get("/api/internal-contacts", requireAdmin, async (req, res) => {
    try {
      const contacts = await db.queryAll("SELECT * FROM internal_contacts ORDER BY created_at DESC");
      res.json(contacts);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/internal-contacts", requireAdmin, async (req, res) => {
    const { phone_number, label } = req.body;
    if (!phone_number) return res.status(400).json({ error: "Phone number is required" });
    const normalizedPhone = phone_number.replace(/[^\d+]/g, "");
    try {
      await db.execute("INSERT INTO internal_contacts (phone_number, label) VALUES (?, ?)", [
        normalizedPhone,
        label || "",
      ]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete("/api/internal-contacts/:id", requireAdmin, async (req, res) => {
    try {
      await db.execute("DELETE FROM internal_contacts WHERE id = ?", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Export Full Data
  app.get("/api/export-full-data", requireAdmin, async (req, res) => {
    const { startDate, endDate, agentId, tag } = req.query;
    const start = startDate as string;
    const end = endDate as string;
    const filterAgentId = agentId ? Number(agentId) : null;
    const filterTag = tag as string;

    try {
      let query = `
        SELECT e.*, COALESCE(a.name, 'Unknown Agent') as agent_name, datetime(e.timestamp, '+3 hours') as local_timestamp
        FROM events e
        LEFT JOIN agents a ON e.agent_id = a.id
        WHERE date(e.timestamp, '+3 hours') BETWEEN ? AND ?
        AND e.target_phone NOT IN (SELECT phone_number FROM internal_contacts)
      `;
      const params: any[] = [start, end];

      if (filterAgentId) {
        query += ` AND e.agent_id = ?`;
        params.push(filterAgentId);
      }
      if (filterTag) {
        query += ` AND a.tag = ?`;
        params.push(filterTag);
      }

      query += ` ORDER BY e.timestamp DESC`;

      const events = await db.queryAll(query, params);
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ==========================================
  // CALLBACKS EXTENSION ENDPOINTS
  // ==========================================

  // GET /api/channel-partner-allocations
  app.get("/api/channel-partner-allocations", requireAuth, async (req, res) => {
    try {
      const data = await getChannelPartnerAllocations(db);
      const unallocatedList = (data.unallocated_partners || []).map((p) => ({
        channel_partner: p,
        assigned_agent_id: null,
        assigned_agent_name: null,
        updated_at: null,
      }));
      const all = [...(data.allocations || []), ...unallocatedList].sort((a, b) =>
        a.channel_partner.localeCompare(b.channel_partner)
      );
      res.json(all);
    } catch (err) {
      console.error("[API] Error fetching channel partner allocations:", err);
      res.status(500).json({ error: "Failed to fetch channel partner allocations" });
    }
  });

  // POST /api/channel-partner-allocations
  app.post("/api/channel-partner-allocations", requireAdmin, async (req, res) => {
    try {
      const { channel_partner, assigned_agent_id } = req.body || {};
      if (!channel_partner || !String(channel_partner).trim()) {
        return res.status(400).json({ error: "channel_partner is required" });
      }
      const agentId = assigned_agent_id === null || assigned_agent_id === undefined || assigned_agent_id === "" 
        ? null 
        : Number(assigned_agent_id);
      await setChannelPartnerAllocation(db, String(channel_partner).trim(), agentId);
      res.json({ success: true, channel_partner, assigned_agent_id: agentId });
    } catch (err) {
      console.error("[API] Error setting channel partner allocation:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/callback-settings
  app.get("/api/callback-settings", requireAuth, async (req, res) => {
    try {
      const settings = await getCallbackSettings(db);
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/callback-settings
  app.post("/api/callback-settings", requireAdmin, async (req, res) => {
    try {
      const updated = await updateCallbackSettings(db, req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/callback-jobs/import
  app.post("/api/callback-jobs/import", requireAdmin, async (req, res) => {
    try {
      const { file_name, imported_by, rows, confirmed } = req.body;
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: "Invalid rows payload. Expected an array of rows." });
      }
      const summary = await importCallbackJobs(db, {
        file_name: file_name || "import.xlsx",
        imported_by: imported_by || "Admin",
        rows,
        confirmed: !!confirmed,
      });
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/callback-jobs
  app.get("/api/callback-jobs", requireAuth, async (req, res) => {
    try {
      const { status, channel_partner, assigned_agent_id, search } = req.query;
      const jobs = await getCallbackJobs(db, {
        status: status as string,
        channel_partner: channel_partner as string,
        assigned_agent_id: assigned_agent_id as string,
        search: search as string,
      });
      res.json(jobs);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PATCH /api/callback-jobs/:id/status
  app.patch("/api/callback-jobs/:id/status", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status } = req.body;
      if (!status || !["GREEN", "AMBER", "RED"].includes(status.toUpperCase())) {
        return res.status(400).json({ error: "Invalid status. Must be 'GREEN', 'AMBER', or 'RED'." });
      }
      const updatedJob = await updateCallbackJobStatus(db, id, status.toUpperCase() as any);
      if (!updatedJob) {
        return res.status(404).json({ error: "Callback job not found." });
      }
      res.json(updatedJob);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/callback-jobs/:id/outcome and POST /api/callback-jobs/:id/log
  const handleCallbackOutcomeLog = async (req: express.Request, res: express.Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { outcome, comment, logged_by } = req.body;

      if (!outcome) {
        return res.status(400).json({ error: "Outcome is required." });
      }
      if (!comment || !String(comment).trim()) {
        return res.status(400).json({ error: "Comment is required." });
      }

      const updatedJob = await logCallbackOutcome(db, id, outcome, comment, logged_by || "Agent");
      res.json(updatedJob);
    } catch (err: any) {
      console.error("[API] Error logging callback outcome:", err);
      if (err.message && (err.message.includes("Invalid outcome") || err.message.includes("Comment is required"))) {
        return res.status(400).json({ error: err.message });
      }
      if (err.message && err.message.includes("not found")) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message || "Failed to log outcome" });
    }
  };

  app.post("/api/callback-jobs/:id/outcome", requireAuth, handleCallbackOutcomeLog);
  app.post("/api/callback-jobs/:id/log", requireAuth, handleCallbackOutcomeLog);

  // GET /api/callback-jobs/:id/logs
  app.get("/api/callback-jobs/:id/logs", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const logs = await getCallbackJobLogs(db, id);
      res.json(logs);
    } catch (err) {
      console.error("[API] Error fetching callback job logs:", err);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // GET /api/callback-jobs/max-attempts-report
  app.get("/api/callback-jobs/max-attempts-report", requireAdmin, async (req, res) => {
    try {
      const report = await getMaxAttemptsReport(db);
      res.json(report);
    } catch (err) {
      console.error("[API] Error fetching max-attempts report:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/callback-jobs/max-attempts-report/excel (and backwards-compatible /csv)
  const handleMaxAttemptsExcel = async (req: express.Request, res: express.Response) => {
    try {
      let report = await getMaxAttemptsReport(db);
      const partnerFilter = (req.query.channel_partner as string || "").trim();
      if (partnerFilter && partnerFilter !== "ALL") {
        report = report.filter((g) => g.channel_partner.toLowerCase() === partnerFilter.toLowerCase());
      }

      const rows: any[] = [];

      for (const group of report) {
        for (const rec of group.records) {
          const entries = rec.chronology && rec.chronology.length > 0 
            ? rec.chronology 
            : rec.attempts.map((a) => ({
                kind: "OUTCOME" as const,
                outcome: a.outcome,
                comment: a.comment,
                logged_by: a.logged_by,
                logged_by_phone: null as string | null,
                timestamp: a.created_at,
              }));

          if (entries.length === 0) {
            rows.push({
              "Vehicle Registration": rec.vehicle_reg_raw,
              "Client Name": rec.client_name || "N/A",
              "Client Phone": rec.client_phone_raw || "",
              "Channel Partner": group.channel_partner,
              "Timestamp": rec.closed_at || "",
              "Type": "NONE",
              "Status / Outcome": "MAX_ATTEMPTS_REACHED",
              "Notes": "",
              "Agent Name": "",
              "Agent Phone": "",
            });
          } else {
            for (const item of entries) {
              const statusOutcome = item.kind === "OUTCOME" ? item.outcome : item.status;
              const notes = item.kind === "OUTCOME" ? item.comment : (item.kind === "SMS" ? item.note : "");
              rows.push({
                "Vehicle Registration": rec.vehicle_reg_raw,
                "Client Name": rec.client_name || "N/A",
                "Client Phone": rec.client_phone_raw || "",
                "Channel Partner": group.channel_partner,
                "Timestamp": item.timestamp || "",
                "Type": item.kind,
                "Status / Outcome": statusOutcome || "",
                "Notes": notes || "",
                "Agent Name": item.logged_by || "",
                "Agent Phone": item.logged_by_phone || "",
              });
            }
          }
        }
      }

      const wb = XLSX.utils.book_new();
      const wsRaw = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, wsRaw, "Raw Data");

      // Sheet 2: Summary - deduplicated by timestamp|kind|status/outcome per client phone
      type SummaryRow = {
        clientName: string;
        clientPhone: string;
        channelPartners: Set<string>;
        vehicles: Set<string>;
        agent: string;
        callKeys: Set<string>;
        smsKeys: Set<string>;
      };

      const summaryByPhone = new Map<string, SummaryRow>();

      for (const group of report) {
        for (const record of group.records) {
          const phone = record.client_phone_raw;
          let entry = summaryByPhone.get(phone);
          if (!entry) {
            entry = {
              clientName: record.client_name || "N/A",
              clientPhone: phone,
              channelPartners: new Set(),
              vehicles: new Set(),
              agent: record.assigned_agent_name || "Unassigned",
              callKeys: new Set(),
              smsKeys: new Set(),
            };
            summaryByPhone.set(phone, entry);
          }
          entry.channelPartners.add(group.channel_partner);
          entry.vehicles.add(record.vehicle_reg_raw);
          for (const chrono of record.chronology || []) {
            const dedupeKey = `${chrono.timestamp}|${chrono.kind}|${"status" in chrono ? chrono.status : chrono.outcome}`;
            if (chrono.kind === "CALL") entry.callKeys.add(dedupeKey);
            if (chrono.kind === "SMS") entry.smsKeys.add(dedupeKey);
          }
        }
      }

      const summaryRows = [...summaryByPhone.values()].map((e) => ({
        "Client Name": e.clientName,
        "Client Phone": e.clientPhone,
        "Channel Partner(s)": [...e.channelPartners].join(", "),
        "Vehicles": [...e.vehicles].join(", "),
        "Vehicle Count": e.vehicles.size,
        "Assigned Agent": e.agent,
        "Total Contact Attempts": e.callKeys.size,
        "Total SMSs Sent": e.smsKeys.size,
      }));

      const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const safePartner = partnerFilter ? `_${partnerFilter.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
      const filename = `max_attempts_report${safePartner}_${new Date().toISOString().split("T")[0]}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      console.error("[API] Error generating max-attempts Excel:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  };

  app.get("/api/callback-jobs/max-attempts-report/excel", requireAdmin, handleMaxAttemptsExcel);
  app.get("/api/callback-jobs/max-attempts-report/csv", requireAdmin, handleMaxAttemptsExcel);
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Solvit server running on http://localhost:${PORT}`);
  });

  // Recurring sweep: close matured callback records within a minute
  setInterval(async () => {
    try {
      await closeMaturedCallbackJobs(db);
    } catch (err) {
      console.error("[Background] Error closing matured callback jobs:", err);
    }
  }, 60 * 1000);
}

startServer();
