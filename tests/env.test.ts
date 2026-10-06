import { describe, expect, it } from "vitest";
import { parseEnv, requireDatabaseEnv } from "../src/lib/env";

describe("server environment", () => {
  it("allows static UI without database configuration", () => {
    expect(parseEnv({})).toEqual({ APP_URL: "http://localhost:3000", DB_POOL_MAX: 5, DORAR_ENABLED: "true" });
  });
  it("requires a database URL for database operations", () => {
    expect(() => requireDatabaseEnv({})).toThrow("DATABASE_URL is required");
  });
  it("accepts PostgreSQL and coerces bounded pool size", () => {
    expect(requireDatabaseEnv({ DATABASE_URL: "postgresql://user:secret@localhost:5432/yaqeen", DB_POOL_MAX: "3" }).DB_POOL_MAX).toBe(3);
  });
  it.each(["https://host/db", "postgresql://host", "not-a-url"])("rejects invalid database configuration: %s", (DATABASE_URL) => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow("Invalid environment");
  });
  it.each([0, 21, 1.5, "many"])("rejects invalid pool sizes: %s", (DB_POOL_MAX) => {
    expect(() => parseEnv({ DB_POOL_MAX })).toThrow("DB_POOL_MAX");
  });
  it.each(["https://user:highly-sensitive@host/db", "malformed-highly-sensitive"])("never echoes credentials in an error: %s", (secret) => {
    expect(() => parseEnv({ DATABASE_URL: secret })).toThrow("Invalid environment");
    try { parseEnv({ DATABASE_URL: secret }); } catch (error) { expect(String(error)).not.toContain("highly-sensitive"); }
  });
  it("rejects non-web app URLs", () => {
    expect(() => parseEnv({ APP_URL: "ftp://example.com" })).toThrow("APP_URL");
  });
  it("allows disabling optional Dorar requests explicitly", () => {
    expect(parseEnv({ DORAR_ENABLED: "false" }).DORAR_ENABLED).toBe("false");
  });
  it.each(["yes", "0", false])("rejects ambiguous Dorar flags", (DORAR_ENABLED) => {
    expect(() => parseEnv({ DORAR_ENABLED })).toThrow("DORAR_ENABLED");
  });
});
