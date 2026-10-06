import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/analyze/claims/route";
import { ExtractionError } from "../src/ai/errors";
import { claim } from "./fixtures/claims";

const { extract, reserve, release } = vi.hoisted(() => ({ extract: vi.fn(), reserve: vi.fn(), release: vi.fn() }));
vi.mock("../src/ai/claim-extraction", () => ({ extractClaims: extract }));
vi.mock("../src/ai/request-limit", () => ({ reserveExtraction: reserve }));
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/analyze/claims", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => { extract.mockReset(); reserve.mockReset().mockReturnValue(release); release.mockReset(); });
describe("POST /api/analyze/claims", () => {
  it("returns only claims with no-store", async () => {
    const text = "A sufficiently long statement."; const result = { claims: [claim(text)] };
    extract.mockResolvedValue(result); const response = await POST(request({ text }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(release).toHaveBeenCalledOnce();
  });
  it("returns claims for a legitimate Render same-origin request", async () => {
    vi.stubEnv("RENDER", "true");
    try {
      const text = "A sufficiently long statement."; const result = { claims: [claim(text)] };
      extract.mockResolvedValue(result);
      const response = await POST(request({ text }, { Origin: "https://yaqeen-ai.onrender.com", "x-forwarded-host": "yaqeen-ai.onrender.com", "x-forwarded-proto": "https" }));
      expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
      expect(extract).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
    } finally { vi.unstubAllEnvs(); }
  });
  it.each([{ text: "" }, { text: "   " }, { text: "short" }, { text: 7 }, {}, { text: "x".repeat(10_001) }, { text: "A sufficiently long statement.", key: "unexpected" }])("rejects invalid input %j without AI", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(extract).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and non-JSON types", async () => {
    const malformed = new Request("http://localhost:3000/api/analyze/claims", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request({ text: "A sufficiently long statement." }, { "Content-Type": "text/plain" }))).status).toBe(415);
  });
  it("limits body size without Content-Length", async () => {
    expect((await POST(request({ text: "x".repeat(70_000) }))).status).toBe(413); expect(extract).not.toHaveBeenCalled();
  });
  it("rejects cross-origin browser requests", async () => {
    expect((await POST(request({ text: "A sufficiently long statement." }, { Origin: "https://foreign.example" }))).status).toBe(403);
  });
  it.each([ ["AI_NOT_CONFIGURED", 503], ["AI_TIMEOUT", 504], ["AI_UNAVAILABLE", 502], ["INVALID_AI_RESPONSE", 502] ] as const)("maps %s to HTTP %s", async (code, status) => {
    extract.mockRejectedValue(new ExtractionError(code)); const response = await POST(request({ text: "A sufficiently long statement." }));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: { code } }); expect(release).toHaveBeenCalledOnce();
  });
  it("does not return exception details", async () => {
    extract.mockRejectedValue(new Error("private key and content")); const response = await POST(request({ text: "A sufficiently long statement." }));
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("private key");
  });
  it("returns a retryable overload response before AI invocation", async () => {
    reserve.mockReturnValue(null); const response = await POST(request({ text: "A sufficiently long statement." }));
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60"); expect(extract).not.toHaveBeenCalled();
  });
});
