import "server-only";
import { Pool } from "pg";
import { requireDatabaseEnv } from "./env";

const globalDb = globalThis as typeof globalThis & { yaqeenPool?: Pool };

/** Lazy connection: the static foundation does not need a running database. */
export function getDb(): Pool {
  if (!globalDb.yaqeenPool) {
    const env = requireDatabaseEnv(process.env);
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", () => console.error("Database pool connection failed."));
    globalDb.yaqeenPool = pool;
  }
  return globalDb.yaqeenPool;
}
