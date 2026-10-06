// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/analyze/relation/route";
import { ExtractionError } from "../src/ai/errors";
import { quotationInput, relation } from "./fixtures/relation";

const { analyze, reserve, release } = vi.hoisted(() => ({ analyze: vi.fn(), reserve: vi.fn(), release: vi.fn() }));
vi.mock("../src/ai/evidence-reasoning", () => ({ analyzeEvidenceRelation: analyze }));
vi.mock("../src/ai/request-limit", () => ({ reserveExtraction: reserve }));
const url = "http://localhost:3000/api/analyze/relation";
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => { analyze.mockReset(); reserve.mockReset().mockReturnValue(release); release.mockReset(); });
describe("POST /api/analyze/relation", () => {
  it("returns only structured analysis, passes original context and disables caching", async () => {
    const result = { analysis: relation() }; analyze.mockResolvedValue(result); const response = await POST(request(quotationInput));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(analyze).toHaveBeenCalledWith(quotationInput, undefined, expect.any(AbortSignal)); expect(release).toHaveBeenCalledOnce();
  });
  it("accepts the minimal contract without original content and with no evidence", async () => {
    analyze.mockResolvedValue({ analysis: relation({ verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: null }) });
    expect((await POST(request({ claim: quotationInput.claim, evidence: [] }))).status).toBe(200);
  });
  it.each([{}, { claim: quotationInput.claim }, { ...quotationInput, claim: {} }, { ...quotationInput, evidence: [{ id: "broken" }] },
    { ...quotationInput, evidence: [quotationInput.evidence[0], quotationInput.evidence[0]] },
    { ...quotationInput, originalContent: "unrelated" }, { ...quotationInput, extra: "unexpected" },
    { ...quotationInput, claim: { ...quotationInput.claim, text: " " } },
    { ...quotationInput, evidence: [{ ...quotationInput.evidence[0], exactText: "x".repeat(100_001) }] },
    { ...quotationInput, evidence: [{ ...quotationInput.evidence[0], exactText: "x".repeat(90_000), metadata: { raw: "x".repeat(90_000) } }] },
  ])("rejects malformed or oversized contract before provider invocation", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(analyze).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies and declared content length", async () => {
    expect((await POST(request({ text: "x".repeat(1024 * 1024 + 1) }))).status).toBe(413);
    expect((await POST(request(quotationInput, { "Content-Length": String(1024 * 1024 + 1) }))).status).toBe(413);
    expect(analyze).not.toHaveBeenCalled();
  });
  it("requires JSON and rejects malformed JSON or cross-origin browsers", async () => {
    expect((await POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status).toBe(400);
    expect((await POST(request(quotationInput, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await POST(request(quotationInput, { Origin: "https://other.test" }))).status).toBe(403);
    expect(analyze).not.toHaveBeenCalled();
  });
  it.each([["AI_NOT_CONFIGURED", 503], ["AI_TIMEOUT", 504], ["AI_UNAVAILABLE", 502], ["INVALID_AI_RESPONSE", 502]] as const)("sanitizes %s as %s", async (code, status) => {
    analyze.mockRejectedValue(new ExtractionError(code)); const response = await POST(request(quotationInput));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: { code } }); expect(release).toHaveBeenCalledOnce();
  });
  it("keeps unexpected details private and shares the existing AI request budget", async () => {
    analyze.mockRejectedValue(new Error("private API key and religious content")); const failed = await POST(request(quotationInput));
    expect(failed.status).toBe(502); expect(await failed.text()).not.toContain("private");
    reserve.mockReturnValue(null); const limited = await POST(request(quotationInput)); expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60"); expect(analyze).toHaveBeenCalledOnce();
  });
});
