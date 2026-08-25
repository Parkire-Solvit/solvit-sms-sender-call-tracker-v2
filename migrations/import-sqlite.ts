import { execFileSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";

const sourcePath = process.env.SQLITE_SOURCE_PATH || "/data/solvit.db";
const sourceSystem = "sqlite-v1";
const batchSize = 1000;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!fs.existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`);

function sqliteRows<T>(sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", sourcePath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
  return output ? (JSON.parse(output) as T[]) : [];
}

function utcTimestamp(value: string | null): string | null {
  if (!value) return null;
  return /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
}

const pool = new pg.Pool({
  connectionString,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

type LegacyAgent = {
  name: string;
  installed_at: string;
  last_active_at: string;
  tag: string | null;
};

type LegacyEvent = {
  legacy_id: number;
  agent_name: string;
  type: string;
  target_phone: string;
  status: string | null;
  reg_no: string | null;
  timestamp: string;
};

type LegacyContact = {
  phone_number: string;
  label: string | null;
  created_at: string;
};

try {
  const schemaVersion = await pool.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0)::int AS version FROM schema_migrations"
  );
  if ((schemaVersion.rows[0]?.version ?? 0) < 2) {
    throw new Error("Schema migration 002 is required. Run npm run db:migrate first.");
  }

  const [{ count: sourceEventCount }] = sqliteRows<{ count: number }>("SELECT COUNT(*) AS count FROM events");
  const agents = sqliteRows<LegacyAgent>(`
    SELECT a.name,
           MIN(a.installed_at) AS installed_at,
           MAX(a.last_active_at) AS last_active_at,
           MAX(CASE WHEN a.tag IS NOT NULL AND TRIM(a.tag) <> '' THEN a.tag END) AS tag
    FROM agents a
    JOIN (SELECT DISTINCT agent_id FROM events) used_agents
      ON used_agents.agent_id = a.id
    GROUP BY a.name
    ORDER BY a.name
  `);

  await pool.query(
    `INSERT INTO legacy_imports (source_system, source_path, source_event_count, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (source_system) DO UPDATE SET
       source_path = EXCLUDED.source_path,
       source_event_count = EXCLUDED.source_event_count,
       updated_at = CURRENT_TIMESTAMP`,
    [sourceSystem, sourcePath, sourceEventCount]
  );

  const agentIds = new Map<string, number>();
  for (const agent of agents) {
    const result = await pool.query<{ id: string; name: string }>(
      `INSERT INTO agents (name, tag, installed_at, last_active_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET
         installed_at = LEAST(agents.installed_at, EXCLUDED.installed_at),
         last_active_at = GREATEST(agents.last_active_at, EXCLUDED.last_active_at),
         tag = CASE
           WHEN agents.tag = 'Uncategorised' THEN EXCLUDED.tag
           ELSE agents.tag
         END
       RETURNING id, name`,
      [
        agent.name,
        agent.tag || "Uncategorised",
        utcTimestamp(agent.installed_at),
        utcTimestamp(agent.last_active_at),
      ]
    );
    agentIds.set(result.rows[0].name, Number(result.rows[0].id));
  }

  let offset = 0;
  while (offset < sourceEventCount) {
    const events = sqliteRows<LegacyEvent>(`
      SELECT e.id AS legacy_id, a.name AS agent_name, e.type, e.target_phone,
             e.status, e.reg_no, e.timestamp
      FROM events e
      JOIN agents a ON a.id = e.agent_id
      ORDER BY e.id
      LIMIT ${batchSize} OFFSET ${offset}
    `);
    if (!events.length) break;

    const params: unknown[] = [];
    const values = events.map((event, index) => {
      const base = index * 9;
      params.push(
        agentIds.get(event.agent_name)!,
        event.type,
        event.target_phone,
        event.status,
        0,
        event.reg_no,
        utcTimestamp(event.timestamp),
        sourceSystem,
        event.legacy_id
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
    });

    await pool.query(
      `INSERT INTO events
        (agent_id, type, target_phone, status, duration, reg_no, timestamp, source_system, source_event_id)
       VALUES ${values.join(",")}
       ON CONFLICT (source_system, source_event_id)
       WHERE source_system IS NOT NULL AND source_event_id IS NOT NULL
       DO NOTHING`,
      params
    );
    offset += events.length;
    console.log(`[DB] Processed ${Math.min(offset, sourceEventCount)}/${sourceEventCount} legacy events`);
  }

  const contacts = sqliteRows<LegacyContact>(
    "SELECT phone_number, label, created_at FROM internal_contacts ORDER BY id"
  );
  for (const contact of contacts) {
    await pool.query(
      `INSERT INTO internal_contacts (phone_number, label, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone_number) DO UPDATE SET
         label = COALESCE(NULLIF(EXCLUDED.label, ''), internal_contacts.label)`,
      [contact.phone_number, contact.label || "Internal Staff", utcTimestamp(contact.created_at)]
    );
  }

  const imported = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM events WHERE source_system = $1",
    [sourceSystem]
  );
  const importedEventCount = Number(imported.rows[0].count);
  if (importedEventCount !== Number(sourceEventCount)) {
    throw new Error(`Verification failed: expected ${sourceEventCount} legacy events, found ${importedEventCount}.`);
  }

  await pool.query(
    `UPDATE legacy_imports SET imported_event_count = $2, completed_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE source_system = $1`,
    [sourceSystem, importedEventCount]
  );
  console.log(`[DB] Import complete: ${agents.length} agents, ${importedEventCount} events, ${contacts.length} contacts`);
} finally {
  await pool.end();
}
