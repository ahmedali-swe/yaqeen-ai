// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.unmock("../src/evidence/explanations/hadeethenc");
import { POST } from "../src/app/api/analyze/evidence/route";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { bukhari71Content, bukhari71Quote, bukhari71Conclusion } from "./fixtures/bukhari-71";
import type { EvidenceCandidate } from "../src/evidence/types";
import searchUnderstanding from "./fixtures/hadeethenc-search-understanding.json";
import understanding from "./fixtures/hadeethenc-understanding.json";

const { retrieve } = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("../src/evidence/retriever", () => ({ retrieveEvidence: retrieve }));
let evidence: EvidenceCandidate[];
beforeAll(async () => { evidence = (await localSahihaynProvider.retrieve(bukhari71Quote, new AbortController().signal)).filter(x => x.id === "sahihayn-bukhari-71"); });
beforeEach(() => {
  retrieve.mockReset();
  (globalThis as typeof globalThis & { evidenceBudget?: { starts: number[]; active: number } }).evidenceBudget = { starts: [], active: 0 };
});
afterEach(() => vi.unstubAllGlobals());
const request = (body: unknown) => new Request("http://localhost/api/analyze/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
it("real evidence endpoint preserves primary evidence with 200 when the official explanation source is down", async () => {
  retrieve.mockResolvedValue({ evidence }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  const response = await POST(request({ claim: bukhari71Quote })), result = await response.json();
  expect(response.status).toBe(200); expect(result.evidence).toEqual(evidence); expect(result.explanations).toEqual([]); expect(result.explanationStatus).toBe("UNAVAILABLE");
  expect(result).not.toHaveProperty("error"); expect(result).not.toHaveProperty("analysis");
});
it("malformed source response cannot replace hadith text or fail the entire evidence endpoint", async () => {
  retrieve.mockResolvedValue({ evidence }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "bad" })));
  const response = await POST(request({ claim: bukhari71Quote })), result = await response.json();
  expect(response.status).toBe(200); expect(result.evidence).toEqual(evidence); expect(result.explanationStatus).toBe("UNAVAILABLE");
});
it("contextual inference receives the exact approved source explanation with provenance but no inherited verdict", async () => {
  retrieve.mockResolvedValueOnce({ evidence: [] }).mockResolvedValueOnce({ evidence });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) => Response.json(String(url).includes("/search/") ? searchUnderstanding : understanding)));
  const context = { originalContent: bukhari71Content, claims: [bukhari71Quote, bukhari71Conclusion], evidenceAnchorClaimId: bukhari71Quote.id };
  const response = await POST(request({ claim: bukhari71Conclusion, context })), result = await response.json();
  expect(response.status).toBe(200); expect(result.evidence).toEqual(evidence);
  expect(result.resolution).toEqual({ evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: bukhari71Quote.id });
  expect(result.explanations[0]).toMatchObject({ evidenceId: evidence[0].id, sourceId: understanding.id, exactExplanation: understanding.explanation, reference: understanding.reference });
  expect(result).not.toHaveProperty("analysis"); expect(result).not.toHaveProperty("verificationStatus"); expect(retrieve).toHaveBeenCalledTimes(2);
});
