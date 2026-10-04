import { z } from "zod";

function isUrl(value: string, protocols: string[], requireDatabase = false) {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && Boolean(url.hostname) && (!requireDatabase || url.pathname.length > 1);
  } catch {
    return false;
  }
}

const postgresUrl = z.string().refine((value) => isUrl(value, ["postgres:", "postgresql:"], true), "Must be a PostgreSQL URL with a host and database name");

const envSchema = z.object({
  DATABASE_URL: postgresUrl.optional(),
  APP_URL: z.string().refine((value) => isUrl(value, ["http:", "https:"]), "Must be an HTTP(S) URL").default("http://localhost:3000"),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
});

export function parseEnv(input: Record<string, unknown>) {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    // Never include raw values or connection strings in diagnostics.
    throw new Error(`Invalid environment: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return result.data;
}

export function requireDatabaseEnv(input: Record<string, unknown>) {
  const env = parseEnv(input);
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for database operations. Copy .env.example to .env.local.");
  return { ...env, DATABASE_URL: env.DATABASE_URL };
}
