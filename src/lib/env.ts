import { z } from "zod";
import { ExtractionError } from "@/ai/errors";

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
  DORAR_ENABLED: z.enum(["true", "false"]).default("true"),
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

/** Deliberately separate from startup validation; never export this to a client. */
export function requireGeminiEnv(input: Record<string, unknown>) {
  const result = z.object({ GEMINI_API_KEY: z.string().trim().min(1).max(512).regex(/^\S+$/) }).safeParse(input);
  if (!result.success) throw new ExtractionError("AI_NOT_CONFIGURED");
  return result.data;
}

export function requireAiProviderEnv(input: Record<string, unknown>) {
  const result = z.object({ AI_PROVIDER: z.enum(["groq", "gemini"]).default("groq") }).safeParse(input);
  if (!result.success) throw new ExtractionError("AI_NOT_CONFIGURED");
  return result.data;
}

export function requireGroqEnv(input: Record<string, unknown>) {
  const result = z.object({
    GROQ_API_KEY: z.string().trim().min(1).max(512).regex(/^\S+$/),
    // Pin a model known to support strict JSON Schema output; no silent fallback.
    GROQ_TEXT_MODEL: z.literal("openai/gpt-oss-120b").default("openai/gpt-oss-120b"),
  }).safeParse(input);
  if (!result.success) throw new ExtractionError("AI_NOT_CONFIGURED");
  return result.data;
}
