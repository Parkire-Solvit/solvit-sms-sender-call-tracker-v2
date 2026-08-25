import pg from "pg";

const { Pool } = pg;
const REQUIRED_SCHEMA_VERSION = 1;

export interface DbAdapter {
  type: "postgresql";
  isConnected: boolean;
  statusMessage: string;
  queryAll<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ lastInsertId: number; affectedRows: number }>;
}

let pool: pg.Pool | null = null;
let activeAdapter: DbAdapter | null = null;

function postgresSql(sql: string): string {
  let index = 0;
  return sql
    .replace(/datetime\(([^,]+),\s*'\+3 hours'\)/gi, "$1 + INTERVAL '3 hours'")
    .replace(/date\(([^,]+),\s*'\+3 hours'\)/gi, "DATE($1 + INTERVAL '3 hours')")
    .replace(/strftime\('%s',\s*([^)]+)\)/gi, "EXTRACT(EPOCH FROM $1)")
    .replace(/\?/g, () => `$${++index}`);
}

export async function initDatabase(): Promise<DbAdapter> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required; PostgreSQL is the only supported database.");

  pool = new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_SIZE || 10),
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  try {
    await pool.query("SELECT 1");
    const result = await pool.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0)::int AS version FROM schema_migrations"
    );
    const version = result.rows[0]?.version ?? 0;
    if (version < REQUIRED_SCHEMA_VERSION) {
      throw new Error(`Schema version ${version} is installed; ${REQUIRED_SCHEMA_VERSION} is required. Run npm run db:migrate.`);
    }
  } catch (error) {
    await pool.end().catch(() => undefined);
    pool = null;
    throw new Error(`PostgreSQL initialization failed: ${(error as Error).message}`, { cause: error });
  }

  activeAdapter = {
    type: "postgresql",
    isConnected: true,
    statusMessage: "Connected to PostgreSQL",
    async queryAll<T = any>(sql: string, params: any[] = []) {
      return (await pool!.query(postgresSql(sql), params)).rows as T[];
    },
    async queryOne<T = any>(sql: string, params: any[] = []) {
      return ((await pool!.query(postgresSql(sql), params)).rows[0] as T) ?? null;
    },
    async execute(sql: string, params: any[] = []) {
      let statement = postgresSql(sql).trim().replace(/;$/, "");
      if (/^INSERT\s/i.test(statement) && !/\bRETURNING\b/i.test(statement)) statement += " RETURNING id";
      const result = await pool!.query(statement, params);
      return { lastInsertId: Number(result.rows[0]?.id ?? 0), affectedRows: result.rowCount ?? 0 };
    },
  };
  return activeAdapter;
}

export function getDb(): DbAdapter {
  if (!activeAdapter) throw new Error("Database not initialized. Call initDatabase() first.");
  return activeAdapter;
}
