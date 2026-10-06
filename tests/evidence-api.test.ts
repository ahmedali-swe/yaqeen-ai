// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/analyze/evidence/route";
import { EvidenceRetrievalError } from "../src/evidence/types";
import { claim } from "./fixtures/claims";
import { arabicExample, quotationClaim, interpretationClaim, hadithEvidence } from "./fixtures/relation";

const { retrieve } = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("../src/evidence/retriever", () => ({ retrieveEvidence: retrieve }));
const state = globalThis as typeof globalThis & { evidenceBudget?: { starts: number[]; active: number } };
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/analyze/evidence", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const input = { claim: claim("إنما الأعمال بالنيات") };
beforeEach(() => { retrieve.mockReset(); state.evidenceBudget = { starts: [], active: 0 }; });
describe("POST /api/analyze/evidence", () => {
  it("resolves and labels contextual evidence without accepting an inherited verdict", async () => {
    retrieve.mockResolvedValueOnce({ evidence: [] }).mockResolvedValueOnce({ evidence: [hadithEvidence] });
    const context = { claims: [quotationClaim, interpretationClaim], originalContent: arabicExample, evidenceAnchorClaimId: quotationClaim.id };
    const response = await POST(request({ claim: interpretationClaim, context }));
    expect(response.status).toBe(200); const body = await response.json();
    expect(body).toEqual({ evidence: [hadithEvidence], resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id }, explanations: expect.any(Array), explanationStatus: "AVAILABLE" });
    expect(body.explanations).toHaveLength(1); expect(body.explanations[0]).toMatchObject({ evidenceId: hadithEvidence.id, provider: "HADEETHENC" });
    expect(body).not.toHaveProperty("analysis");
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect((await POST(request({ claim: interpretationClaim, context: { ...context, evidenceAnchorClaimId: "nonexistent" } }))).status).toBe(400);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });
  it("uses the existing extracted claim contract, supports genuine empty results and disables caching", async () => {
    retrieve.mockResolvedValue({ evidence: [] }); const response = await POST(request(input));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ evidence: [] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(retrieve).toHaveBeenCalledWith(input.claim, undefined, expect.any(AbortSignal));
    expect(state.evidenceBudget?.active).toBe(0);
  });
  it.each([{}, { claim: {} }, { claim: { ...input.claim, text: "  " } }, { claim: { ...input.claim, text: "x".repeat(10_001) } }, { ...input, url: "https://evil.test" }])("rejects invalid input before source requests", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(retrieve).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON, oversized streams, non-JSON and cross-origin requests", async () => {
    expect((await POST(new Request("http://localhost/api/analyze/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status).toBe(400);
    expect((await POST(request({ claim: "x".repeat(256 * 1024) }))).status).toBe(413);
    expect((await POST(request(input, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await POST(request(input, { Origin: "https://evil.test" }))).status).toBe(403);
    expect(retrieve).not.toHaveBeenCalled();
  });
  it.each([["EVIDENCE_TIMEOUT", 504], ["EVIDENCE_UNAVAILABLE", 502], ["INVALID_EVIDENCE_RESPONSE", 502]] as const)("sanitizes %s as HTTP %s", async (code, status) => {
    retrieve.mockRejectedValue(new EvidenceRetrievalError(code)); const response = await POST(request(input));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: { code } }); expect(state.evidenceBudget?.active).toBe(0);
  });
  it("does not expose private exception details", async () => {
    retrieve.mockRejectedValue(new Error("private query and credentials")); const response = await POST(request(input));
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("private");
  });
  it("bounds requests before invoking sources", async () => {
    state.evidenceBudget = { starts: [], active: 3 };
    const response = await POST(request(input)); expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60"); expect(retrieve).not.toHaveBeenCalled();
  });
});
