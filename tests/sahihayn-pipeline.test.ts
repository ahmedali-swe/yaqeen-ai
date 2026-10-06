// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { POST as extract } from "../src/app/api/analyze/claims/route";
import { POST as retrieve } from "../src/app/api/analyze/evidence/route";
import { POST as reason } from "../src/app/api/analyze/relation/route";
import { ClaimExtractionResultSchema } from "../src/domain/claim-extraction";
import { EvidenceResultSchema } from "../src/evidence/types";
import { RelationResultSchema } from "../src/domain/evidence-reasoning";
import { arabicExample, quotationClaim, interpretationClaim, relation } from "./fixtures/relation";
import { bukhari71Content, bukhari71Quote, bukhari71Conclusion } from "./fixtures/bukhari-71";

function request(path: string, body: unknown) { return new Request(`http://localhost:3000/api/analyze/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
function completion(value: unknown) { return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }); }
const state = globalThis as typeof globalThis & { evidenceBudget?: { starts: number[]; active: number }; extractionBudget?: { started: number[]; active: number } };
beforeEach(() => {
  state.evidenceBudget = { starts: [], active: 0 }; state.extractionBudget = { started: [], active: 0 };
  vi.stubEnv("AI_PROVIDER", "groq"); vi.stubEnv("GROQ_API_KEY", "unit-test-key"); vi.stubEnv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b"); vi.stubEnv("DORAR_ENABLED", "false");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("runs Bukhari 71 through real retrieval and provenance validation with independent mocked AI observations", async () => {
  const payloads: { claim: { id: string; text: string }; evidence: { id: string }[]; originalContent: string }[] = [];
  const fetcher = vi.fn().mockImplementation((url: string, init: RequestInit) => {
    if (url !== "https://api.groq.com/openai/v1/chat/completions") throw new Error("Unexpected external evidence call");
    const body = JSON.parse(String(init.body));
    if (body.response_format.json_schema.name === "claim_extraction_result") return Promise.resolve(completion({ claims: [bukhari71Quote, bukhari71Conclusion] }));
    const payload = JSON.parse(body.messages[1].content); payloads.push(payload);
    return Promise.resolve(completion({ analysis: relation({
      strongestEvidenceId: "sahihayn-bukhari-71", supportedMeaning: "ينص الدليل على أن من يرد الله به خيرًا يفقهه في الدين.", reasoning: payload.claim.claimType === "QUOTE" ? "الاقتباس يطابق المقتطف من الحديث المقدم." : "لا ينص الدليل على أن عدم التخصص أو سعة العلم ينفي إرادة الخير للشخص.",
      ...(payload.claim.claimType === "QUOTE" ? {} : { verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: "فهذا دليل على أن الله لا يريد به خيرًا" }),
    }) }));
  });
  vi.stubGlobal("fetch", fetcher);
  const extracted = await extract(request("claims", { text: bukhari71Content })); expect(extracted.status).toBe(200);
  const { claims } = ClaimExtractionResultSchema.parse(await extracted.json());
  expect(claims).toHaveLength(2);
  expect(claims[1].text).not.toContain("ثم استنتج أن");
  expect(bukhari71Content.slice(claims[1].originalStart!, claims[1].originalEnd!)).toBe(claims[1].text);
  const directResponse = await retrieve(request("evidence", { claim: claims[0] })); expect(directResponse.status).toBe(200);
  const direct = EvidenceResultSchema.parse(await directResponse.json());
  expect(direct.evidence[0]).toMatchObject({ id: "sahihayn-bukhari-71", sourceName: "صحيح البخاري", reference: "صحيح البخاري، حديث 71" });
  const snapshot = JSON.stringify(direct.evidence);
  const quoteResponse = await reason(request("relation", { claim: claims[0], evidence: direct.evidence, originalContent: bukhari71Content })); expect(quoteResponse.status).toBe(200);
  expect(RelationResultSchema.parse(await quoteResponse.json()).analysis).toMatchObject({ verificationStatus: "SUPPORTED", relationType: "DIRECT_QUOTE" });
  const contextualResponse = await retrieve(request("evidence", { claim: claims[1], context: { claims, originalContent: bukhari71Content, evidenceAnchorClaimId: claims[0].id } })); expect(contextualResponse.status).toBe(200);
  const contextual = EvidenceResultSchema.parse(await contextualResponse.json());
  expect(contextual.resolution).toEqual({ evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: claims[0].id });
  expect(contextual.evidence).toEqual(direct.evidence); expect(contextual).not.toHaveProperty("analysis");
  const conclusionResponse = await reason(request("relation", { claim: claims[1], evidence: contextual.evidence, originalContent: bukhari71Content })); expect(conclusionResponse.status).toBe(200);
  expect(RelationResultSchema.parse(await conclusionResponse.json()).analysis).toMatchObject({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", strongestEvidenceId: "sahihayn-bukhari-71", unsupportedPart: "فهذا دليل على أن الله لا يريد به خيرًا" });
  expect(payloads).toHaveLength(2);
  expect(payloads[1].claim.id).toBe(claims[1].id); expect(payloads[1].originalContent).toBe(bukhari71Content);
  expect(payloads[1]).not.toHaveProperty("analysis"); expect(payloads[1]).not.toHaveProperty("verificationStatus");
  expect(JSON.stringify(contextual.evidence)).toBe(snapshot);
});

it("runs the Arabic extraction → bundled primary corpus → independent reasoning API pipeline with only AI transport mocked", async () => {
  const fetcher = vi.fn().mockImplementation((url: string, init: RequestInit) => {
    if (url !== "https://api.groq.com/openai/v1/chat/completions") throw new Error("Unexpected external evidence call");
    const body = JSON.parse(String(init.body));
    if (body.response_format.json_schema.name === "claim_extraction_result") return Promise.resolve(completion({ claims: [quotationClaim, interpretationClaim] }));
    const payload = JSON.parse(body.messages[1].content);
    const analysis = payload.claim.claimType === "QUOTE" ? relation({ strongestEvidenceId: payload.evidence[0].id }) : relation({
      strongestEvidenceId: payload.evidence[0].id, verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE",
      unsupportedPart: "كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول", supportedMeaning: "يربط الدليل الأعمال بالنيات؛ لا يضع شرط الراحة النفسية.", reasoning: "النتيجة المضافة لا يتضمنها الحديث المقدم.",
    });
    return Promise.resolve(completion({ analysis }));
  });
  vi.stubGlobal("fetch", fetcher);
  const extractionResponse = await extract(request("claims", { text: arabicExample })); expect(extractionResponse.status).toBe(200);
  const { claims } = ClaimExtractionResultSchema.parse(await extractionResponse.json()); expect(claims.map((item) => item.claimType)).toEqual(["QUOTE", "INTERPRETATION"]);
  const evidenceResponse = await retrieve(request("evidence", { claim: claims[0] })); expect(evidenceResponse.status).toBe(200);
  const result = EvidenceResultSchema.parse(await evidenceResponse.json()); expect(result.retrieval?.hadith).toBe("LOCAL_PRIMARY");
  expect(result.evidence[0].id).toBe("sahihayn-bukhari-1"); const snapshot = JSON.stringify(result.evidence);
  const contextualResponse = await retrieve(request("evidence", { claim: claims[1], context: { claims, originalContent: arabicExample, evidenceAnchorClaimId: claims[0].id } }));
  expect(contextualResponse.status).toBe(200);
  const contextual = EvidenceResultSchema.parse(await contextualResponse.json());
  expect(contextual.resolution).toEqual({ evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: claims[0].id });
  expect(contextual.evidence).toEqual(result.evidence);
  const analyses = [];
  for (const claim of claims) {
    const response = await reason(request("relation", { claim, evidence: result.evidence, originalContent: arabicExample })); expect(response.status).toBe(200);
    analyses.push(RelationResultSchema.parse(await response.json()).analysis);
  }
  expect(analyses[0]).toMatchObject({ verificationStatus: "SUPPORTED", relationType: "DIRECT_QUOTE" });
  expect(analyses[1]).toMatchObject({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: "كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول" });
  expect(JSON.stringify(result.evidence)).toBe(snapshot);
  expect(fetcher.mock.calls.filter(([url]) => url === "https://api.groq.com/openai/v1/chat/completions")).toHaveLength(3);
  // The interpretation tries direct retrieval first; the unavailable keyword
  // transport is isolated before the reliable bundled anchor is resolved.
  expect(fetcher).toHaveBeenCalledTimes(4);
});
