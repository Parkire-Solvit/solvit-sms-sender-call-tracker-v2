import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const version = Number(file.split("_", 1)[0]);
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
    if (applied.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await fs.readFile(path.join(migrationsDirectory, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [version, file]);
      await client.query("COMMIT");
      console.log(`[DB] Applied migration ${file}`);
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
