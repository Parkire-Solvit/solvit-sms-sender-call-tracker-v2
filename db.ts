import pg from "pg";

const { Pool } = pg;
const REQUIRED_SCHEMA_VERSION = 34;

export interface DbTransactionClient {
  queryAll<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ lastInsertId: number; affectedRows: number }>;
}

export interface DbAdapter {
  type: "postgresql";
  isConnected: boolean;
  statusMessage: string;
  queryAll<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ lastInsertId: number; affectedRows: number }>;
  transaction<T>(work: (tx: DbTransactionClient) => Promise<T>): Promise<T>;
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
    // Fail fast instead of waiting forever: a request that cannot get a connection within 10 seconds fails (and an
    // agent's outcome is kept on the device and retried) rather than hanging the whole server.
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10_000),
    // No single statement may run longer than this, and a transaction left idle is ended by the database.
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 60_000),
    idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TX_TIMEOUT_MS || 60_000),
    // Detect dead network connections instead of waiting on them indefinitely.
    keepAlive: true,
  });
  // An idle connection that drops (database restart, network blip) must not crash the server.
  pool.on("error", (error) => {
    console.error("[DB] An idle database connection failed and was discarded:", error.message);
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
    async transaction<T>(work: (tx: DbAdapter) => Promise<T>) {
      const client = await pool!.connect();
      const tx: DbAdapter = {
        type: "postgresql",
        isConnected: true,
        statusMessage: "PostgreSQL transaction",
        async queryAll<U = any>(sql: string, params: any[] = []) {
          return (await client.query(postgresSql(sql), params)).rows as U[];
        },
        async queryOne<U = any>(sql: string, params: any[] = []) {
          return ((await client.query(postgresSql(sql), params)).rows[0] as U) ?? null;
        },
        async execute(sql: string, params: any[] = []) {
          let statement = postgresSql(sql).trim().replace(/;$/, "");
          if (/^INSERT\s/i.test(statement) && !/\bRETURNING\b/i.test(statement)) statement += " RETURNING id";
          const result = await client.query(statement, params);
          return { lastInsertId: Number(result.rows[0]?.id ?? 0), affectedRows: result.rowCount ?? 0 };
        },
        async transaction<U>(nested: (inner: DbAdapter) => Promise<U>) {
          return nested(tx);
        },
      };
      let broken: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await work(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          // The connection itself is broken: do not hand it back to the pool for the next request.
          broken = rollbackError as Error;
        }
        throw error;
      } finally {
        client.release(broken);
      }
    },
  };
  return activeAdapter;
}

export function getDb(): DbAdapter {
  if (!activeAdapter) throw new Error("Database not initialized. Call initDatabase() first.");
  return activeAdapter;
}

// Email synchronization needs transactions for idempotent message insertion,
// ownership selection and cursor updates. Reuse the application's pool.
export function getPostgresPool(): pg.Pool {
  if (!pool) throw new Error('Database not initialized. Call initDatabase() first.');
  return pool;
}
