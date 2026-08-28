import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { initDatabase, getDb } from "./db";
import { getSystemSettings, updateSystemSettings, getSettingsChangeLogs } from "./settingsManager";
import { evaluateCompliance, RawEvent, RawAgent } from "./complianceEngine";

// SSE Clients for real-time agent name push
const agentClients = new Map<number, any>();

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const PORT = Number(process.env.PORT || 3000);

  // PostgreSQL only. Schema changes are applied by `npm run db:migrate`.
  const db = await initDatabase();
  console.log(`[DB] Engine active: ${db.type.toUpperCase()} - ${db.statusMessage}`);

  // Ensure default system settings exist
  await getSystemSettings(db);

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

  // Admin Login
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body || {};
    const submittedUser = (username || "").trim().toLowerCase();
    const submittedPass = (password || "").trim();

    const envUser = (process.env.ADMIN_USERNAME || "").trim().toLowerCase();
    const envPass = (process.env.ADMIN_PASSWORD || "").trim();

    const isValid = Boolean(envUser && envPass) && submittedUser === envUser && submittedPass === envPass;

    if (isValid) {
      console.log(`[AUTH] Admin login successful for "${username}"`);
      res.json({ success: true, token: "solvit-admin-session" });
    } else {
      console.warn(`[AUTH] Invalid login attempt for "${username}"`);
      res.status(401).json({ error: "Invalid credentials" });
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
        ? await db.queryOne("SELECT id FROM agents WHERE id = ?", [requestedAgentId])
        : null;

      if (!agent) {
        agent = await db.queryOne("SELECT id FROM agents WHERE name = ?", [name]);
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

      const agent_id = agent?.id || null;

      const result = await db.execute(
        `INSERT INTO events (agent_id, type, target_phone, status, duration, reg_no)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [agent_id, type, finalTargetPhone, status, finalDuration, finalRegNo]
      );

      // Update agent heartbeat
      if (agent_id) {
        await db.execute("UPDATE agents SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?", [agent_id]);
      }

      res.json({ success: true, id: result.lastInsertId });
    } catch (err) {
      console.error("[API] Database error in log-event:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Update Agent Tag
  app.post("/api/update-agent-tag", async (req, res) => {
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
  app.post("/api/update-agent-name", async (req, res) => {
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
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await getSystemSettings(db);
      const changeLogs = await getSettingsChangeLogs(db);
      res.json({ settings, change_logs: changeLogs });
    } catch (err) {
      console.error("[API] Error fetching settings:", err);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", async (req, res) => {
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
  let total_calls_connected = 0;
  let total_calls_outgoing_connected = 0;
  let total_calls_incoming_connected = 0;
  let total_calls_not_picked = 0;
  let total_calls_missed = 0;

  for (const e of events) {
    const type = (e.type || "").toUpperCase();
    const status = (e.status || "").toUpperCase();
    const duration = Number(e.duration) || 0;

    if (type === "SMS") {
      total_sms += 1;
    } else if (type === "CALL") {
      if (status === "MISSED") {
        total_calls_missed += 1;
        total_calls_incoming += 1;
      } else if (status === "INCOMING") {
        total_calls_incoming += 1;
        if (duration > 0) {
          total_calls_incoming_connected += 1;
          total_calls_connected += 1;
        }
      } else if (status === "CONNECTED") {
        total_calls_made += 1;
        total_calls_outgoing_connected += 1;
        total_calls_connected += 1;
      } else if (["NOT_PICKED", "FAILED", "BUSY", "NO_ANSWER"].includes(status)) {
        total_calls_made += 1;
        total_calls_not_picked += 1;
      } else if (status === "OUTGOING") {
        total_calls_made += 1;
        if (duration > 0) {
          total_calls_outgoing_connected += 1;
          total_calls_connected += 1;
        } else {
          total_calls_not_picked += 1;
        }
      } else {
        total_calls_made += 1;
      }
    }
  }

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
  app.get("/api/stats", async (req, res) => {
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
      const allAgentsList = await db.queryAll("SELECT id, name, tag FROM agents WHERE name != 'Unknown Agent' ORDER BY name ASC");
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
  app.get("/api/compliance-stats", async (req, res) => {
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
      let agentsQuery = "SELECT id, name, phone_number, tag, installed_at, last_active_at FROM agents WHERE name != 'Unknown Agent'";
      const agentsParams: any[] = [];
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
      const allAgentsList = await db.queryAll("SELECT id, name, tag FROM agents WHERE name != 'Unknown Agent' ORDER BY name ASC");
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
  app.get("/api/search-contacts", async (req, res) => {
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
  app.get("/api/contact-history", async (req, res) => {
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
  app.get("/api/events-detail", async (req, res) => {
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
  app.get("/api/internal-contacts", async (req, res) => {
    try {
      const contacts = await db.queryAll("SELECT * FROM internal_contacts ORDER BY created_at DESC");
      res.json(contacts);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/internal-contacts", async (req, res) => {
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

  app.delete("/api/internal-contacts/:id", async (req, res) => {
    try {
      await db.execute("DELETE FROM internal_contacts WHERE id = ?", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Export Full Data
  app.get("/api/export-full-data", async (req, res) => {
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
}

startServer();
