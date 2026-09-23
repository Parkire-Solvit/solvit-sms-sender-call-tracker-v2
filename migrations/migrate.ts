import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Migration runner.
 *
 * Migrations are de-duplicated by their FILENAME (the `name` column), not by a
 * numeric prefix. Two migrations that happen to share the same number prefix
 * (e.g. two people each add a `020_*.sql` off the same base) will therefore both
 * run instead of one silently skipping the other. Versions are assigned
 * monotonically in apply order, decoupled from the filename, so a version
 * primary-key collision is impossible.
 *
 * Convention for NEW migrations: prefix the filename with a UTC timestamp so two
 * authors never collide and files sort chronologically, e.g.
 *   20260924T1130_add_widget_flag.sql
 * Legacy NNN_ files keep working unchanged. Never rename an already-applied file
 * (dedup is by name, so a rename would make it re-run).
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to run migrations.");

const migrationsDirectory = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({
  connectionString,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const files = (await fs.readdir(migrationsDirectory))
    .filter((file) => /\.sql$/.test(file))
    .sort();

  const appliedRes = await pool.query("SELECT name FROM schema_migrations");
  const appliedNames = new Set<string>(appliedRes.rows.map((r) => r.name as string));

  const maxRes = await pool.query("SELECT COALESCE(MAX(version), 0)::int AS v FROM schema_migrations");
  let nextVersion = Number(maxRes.rows[0]?.v ?? 0);

  for (const file of files) {
    if (appliedNames.has(file)) continue;
    nextVersion += 1;
    const version = nextVersion;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await fs.readFile(path.join(migrationsDirectory, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [version, file]);
      await client.query("COMMIT");
      console.log(`[DB] Applied migration ${file} (version ${version})`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
