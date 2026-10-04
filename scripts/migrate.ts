import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createDatabaseClient, reportDatabaseError } from "./database";

async function migrate() {
  const client = createDatabaseClient();
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(728194031)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const folder = new URL("../db/migrations/", import.meta.url);
    const files = (await readdir(folder)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await readFile(new URL(name, folder), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE name = $1", [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error("Applied migration was modified; add a new migration instead.");
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
      console.log(`Applied ${name}`);
    }
    await client.query("COMMIT");
    console.log("Database migrations complete.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Error && error.message.startsWith("Applied migration")) console.error(error.message);
    throw error;
  } finally {
    await client.end();
  }
}

migrate().catch(reportDatabaseError);
