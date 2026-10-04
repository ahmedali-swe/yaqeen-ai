import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { requireDatabaseEnv } from "../src/lib/env";

export function createDatabaseClient() {
  loadEnvConfig(process.cwd(), true);
  const env = requireDatabaseEnv(process.env);
  return new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000, statement_timeout: 30_000 });
}

export function reportDatabaseError(error: unknown) {
  // Environment errors are sanitized; connection errors may contain credentials.
  if (error instanceof Error && (error.message.startsWith("Invalid environment:") || error.message.startsWith("DATABASE_URL is required"))) {
    console.error(error.message);
  } else {
    console.error("Database operation failed. Check database availability, credentials, permissions and pgvector installation. No secrets were logged.");
  }
  process.exitCode = 1;
}
