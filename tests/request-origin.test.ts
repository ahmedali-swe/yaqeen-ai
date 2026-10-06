import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidRequestOrigin } from "../src/lib/request-origin";
import { POST as claims } from "../src/app/api/analyze/claims/route";
import { POST as evidence } from "../src/app/api/analyze/evidence/route";
import { POST as relation } from "../src/app/api/analyze/relation/route";
import { POST as patch } from "../src/app/api/analyze/patch/route";

const publicOrigin = "https://yaqeen-ai.onrender.com";
const forwarded = { "x-forwarded-host": "yaqeen-ai.onrender.com", "x-forwarded-proto": "https" };
function request(headers: Record<string, string>, url = "http://localhost:3000/api/analyze/claims") {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });
}

beforeEach(() => { vi.stubEnv("RENDER", ""); vi.stubEnv("TRUST_PROXY", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("request origin validation", () => {
  it("accepts local same-origin and clients without Origin", () => {
    expect(isValidRequestOrigin(request({ Origin: "http://localhost:3000" }))).toBe(true);
    expect(isValidRequestOrigin(request({}))).toBe(true);
  });
  it("uses Host when the request URL uses an internal hostname", () => {
    expect(isValidRequestOrigin(request({ Origin: "http://localhost:3000", Host: "localhost:3000" }, "http://internal:10000/api/analyze/claims"))).toBe(true);
  });
  it("accepts Render's forwarded public authority instead of the internal URL", () => {
    vi.stubEnv("RENDER", "true");
    expect(isValidRequestOrigin(request({ Origin: publicOrigin, ...forwarded, Host: "internal:10000" }))).toBe(true);
    expect(isValidRequestOrigin(request({ Origin: "http://localhost:3000", ...forwarded }))).toBe(false);
  });
  it("supports forwarded protocol with the normal public Host", () => {
    vi.stubEnv("RENDER", "true");
    expect(isValidRequestOrigin(request({ Origin: publicOrigin, Host: "yaqeen-ai.onrender.com", "x-forwarded-proto": "https" }))).toBe(true);
  });
  it("supports explicit trust for another proxy and other public hosts", () => {
    vi.stubEnv("TRUST_PROXY", "true");
    expect(isValidRequestOrigin(request({ Origin: "https://custom.example:8443", "x-forwarded-host": "custom.example:8443", "x-forwarded-proto": "https" }))).toBe(true);
  });
  it("ignores forwarded values without explicit proxy trust", () => {
    const headers = { ...forwarded, Origin: publicOrigin };
    expect(isValidRequestOrigin(request(headers))).toBe(false);
    expect(isValidRequestOrigin(request({ ...headers, Origin: "http://localhost:3000" }))).toBe(true);
    vi.stubEnv("TRUST_PROXY", "false");
    expect(isValidRequestOrigin(request(headers))).toBe(false);
  });
  it("selects the last proxy values, trimming list whitespace", () => {
    vi.stubEnv("RENDER", "true");
    const headers = { "x-forwarded-host": "evil.example, yaqeen-ai.onrender.com", "x-forwarded-proto": "http, https" };
    expect(isValidRequestOrigin(request({ Origin: publicOrigin, ...headers }))).toBe(true);
    expect(isValidRequestOrigin(request({ Origin: "http://evil.example", ...headers }))).toBe(false);
    expect(isValidRequestOrigin(request({ Origin: publicOrigin, "x-forwarded-host": "yaqeen-ai.onrender.com, internal", "x-forwarded-proto": "https, http" }))).toBe(false);
  });
  it.each([
    ["https://YAQEEN-AI.onrender.com:443", "YAQEEN-AI.onrender.com:443", "HTTPS"],
    ["http://localhost:3000", "LOCALHOST:3000", "HTTP"],
    ["http://[::1]:3000", "[::1]:3000", "http"],
  ])("normalizes protocol, host and default ports: %s", (origin, host, proto) => {
    vi.stubEnv("RENDER", "true");
    expect(isValidRequestOrigin(request({ Origin: origin, "x-forwarded-host": host, "x-forwarded-proto": proto }))).toBe(true);
  });
  it.each(["", "null", "not a URL", "https://", "https://yaqeen-ai.onrender.com/", `${publicOrigin}/path`, `${publicOrigin}?q=1`, `${publicOrigin}#fragment`, "https://user@yaqeen-ai.onrender.com", `${publicOrigin}, https://evil.example`, "https://yaqeen-ai.onrender.com\\evil", "ftp://yaqeen-ai.onrender.com", "https://yaqeen-ai.onrender.com:99999"])("rejects malformed Origin %j", (origin) => {
    vi.stubEnv("RENDER", "true");
    expect(isValidRequestOrigin(request({ Origin: origin, ...forwarded }))).toBe(false);
  });
  it.each([
    { "x-forwarded-host": "" }, { "x-forwarded-host": "yaqeen-ai.onrender.com," },
    { "x-forwarded-host": "user@yaqeen-ai.onrender.com" }, { "x-forwarded-host": "yaqeen-ai.onrender.com/path" },
    { "x-forwarded-host": "yaqeen-ai.onrender.com:99999" }, { "x-forwarded-host": "yaqeen-ai.onrender.com?query" },
    { "x-forwarded-proto": "" }, { "x-forwarded-proto": "https," },
    { "x-forwarded-proto": "javascript" }, { "x-forwarded-proto": "https://" },
  ])("fails closed for malformed trusted metadata %j", (headers) => {
    vi.stubEnv("RENDER", "true");
    expect(isValidRequestOrigin(request({ Origin: publicOrigin, ...forwarded, ...headers }))).toBe(false);
  });
  it("rejects a malformed Host rather than falling back to the request URL", () => {
    expect(isValidRequestOrigin(request({ Origin: "http://localhost:3000", Host: "localhost:3000, evil.example" }))).toBe(false);
  });
});

describe.each([["claims", claims], ["evidence", evidence], ["relation", relation], ["patch", patch]] as const)("%s route origin guard", (_name, post) => {
  it.each([
    ["local", { Origin: "http://localhost:3000" }],
    ["Render", { Origin: publicOrigin, ...forwarded }],
    ["Render Host fallback", { Origin: publicOrigin, Host: "yaqeen-ai.onrender.com", "x-forwarded-proto": "https" }],
  ])("accepts %s origins and proceeds to body validation", async (_label, headers) => {
    vi.stubEnv("RENDER", "true");
    // Invalid input stops before any AI/retrieval calls, after the origin guard.
    const response = await post(request(headers));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_INPUT" } });
  });
  it.each(["https://evil.example", "not a URL", "null", "", `${publicOrigin}/path`, "http://localhost:3000"])("returns INVALID_ORIGIN 403 for %j against the public host", async (origin) => {
    vi.stubEnv("RENDER", "true");
    const response = await post(request({ Origin: origin, ...forwarded }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "INVALID_ORIGIN" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns 403 for malformed proxy metadata", async () => {
    vi.stubEnv("RENDER", "true");
    const response = await post(request({ Origin: publicOrigin, ...forwarded, "x-forwarded-proto": "https," }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "INVALID_ORIGIN" } });
  });
});
