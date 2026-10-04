import { loadEnvConfig } from "@next/env";
import { requireDatabaseEnv } from "../src/lib/env";

try {
  loadEnvConfig(process.cwd(), true);
  requireDatabaseEnv(process.env);
  console.log("Environment is valid. Database connectivity has not been checked.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Environment validation failed.");
  process.exitCode = 1;
}
