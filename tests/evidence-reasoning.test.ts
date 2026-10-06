// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeEvidenceRelation, REASONING_TIMEOUT_MS } from "../src/ai/evidence-reasoning";
import { ExtractionError } from "../src/ai/errors";
import { RelationInputSchema, RelationResultSchema, type RelationAnalysis, type RelationInput, type ReadonlyRelationInput } from "../src/domain/evidence-reasoning";
import { claim } from "./fixtures/claims";
import { arabicExample, hadithEvidence, interpretationClaim, quotationInput, relation } from "./fixtures/relation";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("evidence-scoped reasoning contract and service", () => {
  const cases: [string, string, Partial<RelationAnalysis>][] = [
    ["exact supported quotation", "إنما الأعمال بالنيات", {}],
    ["faithful paraphrase", "ترتبط الأعمال بالنيات ولكل إنسان ما نواه", { relationType: "PARAPHRASE" }],
    ["overgeneralization", "كل عمل مقبول مهما كانت نيته", { verificationStatus: "UNSUPPORTED", relationType: "OVERGENERALIZATION", unsupportedPart: "كل عمل مقبول مهما كانت نيته", reasoning: "تعميم القبول يتجاوز النص المقدم المتعلق بالنية." }],
    ["unsupported inference", interpretationClaim.text, { verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: "لا يشعر صاحبه بالراحة النفسية", reasoning: "لا ينص الدليل المقدم على الراحة النفسية شرطًا لقبول العمل." }],
    ["missing context", "كل عمل مقبول", { verificationStatus: "NEEDS_CONTEXT", relationType: "MISSING_CONTEXT", missingContext: "حذف الادعاء تعلق الأعمال بالنية الوارد في الدليل المقدم.", reasoning: "لا يمكن استنتاج القبول دون سياق النية من النص المقدم." }],
    ["specialist-required case", "هل عملي هذا مقبول شرعًا في حالتي الشخصية؟", { verificationStatus: "REQUIRES_SPECIALIST", relationType: "NONE", requiresSpecialist: true, reasoning: "تطبيق الحكم على حالة شخصية يتطلب مراجعة مختص، ولا يحدده هذا النص وحده." }],
    ["partially supported", "الأعمال بالنيات ولا يشعر صاحبه بالراحة النفسية", { verificationStatus: "PARTIALLY_SUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: "ولا يشعر صاحبه بالراحة النفسية", reasoning: "العلاقة بالنية مذكورة، أما الإضافة عن الراحة النفسية فليست في الدليل." }],
    ["incorrect attribution", "قال أفلاطون: إنما الأعمال بالنيات", { verificationStatus: "UNSUPPORTED", relationType: "MISATTRIBUTION", unsupportedPart: "قال أفلاطون", reasoning: "نسبة النص إلى أفلاطون لا تتفق مع بيانات المصدر المقدم." }],
    ["translation drift", "Actions depend on psychological comfort.", { verificationStatus: "UNSUPPORTED", relationType: "TRANSLATION_DRIFT", unsupportedPart: "psychological comfort", reasoning: "الترجمة استبدلت معنى النيات بالراحة النفسية التي لا يذكرها النص." }],
  ];
  it.each(cases)("accepts a valid structured %s and binds it to the given claim/evidence", async (_, text, classification) => {
    const input = { claim: claim(text), evidence: [hadithEvidence] };
    const expected = relation(classification); const provider = { analyze: vi.fn().mockResolvedValue({ analysis: expected }) };
    expect(await analyzeEvidenceRelation(input, provider)).toEqual({ analysis: expected });
    expect(provider.analyze).toHaveBeenCalledWith(expect.objectContaining({ claim: expect.objectContaining({ text }), evidence: [hadithEvidence] }), expect.any(AbortSignal));
  });
  it("analyzes the interpretation independently even when it shares a supported quote's evidence", async () => {
    const provider = { analyze: vi.fn().mockResolvedValueOnce({ analysis: relation() }).mockResolvedValueOnce({ analysis: relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: "الراحة النفسية", reasoning: "لا يثبت النص المقدم شرط الراحة النفسية." }) }) };
    const quote = await analyzeEvidenceRelation(quotationInput, provider);
    const interpretation = await analyzeEvidenceRelation({ ...quotationInput, claim: interpretationClaim }, provider);
    expect(quote.analysis.verificationStatus).toBe("SUPPORTED"); expect(interpretation.analysis.verificationStatus).toBe("UNSUPPORTED");
    expect(provider.analyze.mock.calls[1][0].claim).toEqual(interpretationClaim);
    expect(provider.analyze.mock.calls[1][0].originalContent).toBe(arabicExample);
  });
  it("returns NEEDS_CONTEXT without invoking AI when there is no evidence", async () => {
    const provider = { analyze: vi.fn() };
    const result = await analyzeEvidenceRelation({ ...quotationInput, evidence: [] }, provider);
    expect(result.analysis).toMatchObject({ verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: null, requiresSpecialist: false });
    expect(provider.analyze).not.toHaveBeenCalled();
  });
  it("gives providers frozen clones while keeping every caller source field unchanged", async () => {
    const input = structuredClone(quotationInput), before = structuredClone(input);
    const provider = { analyze: vi.fn(async (received: ReadonlyRelationInput) => {
      expect(Object.isFrozen(received)).toBe(true); expect(Object.isFrozen(received.claim)).toBe(true);
      expect(Object.isFrozen(received.evidence)).toBe(true); expect(Object.isFrozen(received.evidence[0].metadata)).toBe(true);
      const attempted = received as unknown as RelationInput;
      expect(() => { attempted.evidence[0].exactText = "changed"; }).toThrow(TypeError);
      expect(() => { attempted.evidence[0].metadata.narrator = "changed"; }).toThrow(TypeError);
      expect(() => { attempted.evidence.push(hadithEvidence); }).toThrow(TypeError);
      return { analysis: relation() };
    }) };
    await analyzeEvidenceRelation(input, provider); expect(input).toEqual(before); expect(Object.isFrozen(input.evidence[0])).toBe(false);
  });
  it.each([
    {}, { analysis: { verificationStatus: "SUPPORTED" } },
    { analysis: { ...relation(), confidence: 0.9 } },
    { analysis: relation({ strongestEvidenceId: "invented-evidence" }) },
    { analysis: relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: "not in the claim" }) },
    { analysis: relation({ verificationStatus: "REQUIRES_SPECIALIST", requiresSpecialist: false }) },
    { analysis: relation({ requiresSpecialist: true }) },
    { analysis: relation({ strongestEvidenceId: null }) },
    { analysis: relation({ unsupportedPart: "الأعمال" }) },
    { analysis: relation({ missingContext: "سياق مهم" }) },
    { analysis: relation({ supportedMeaning: "  " }) },
    { analysis: relation({ reasoning: "English-only explanation" }) },
    { analysis: relation({ verificationStatus: "PARTIALLY_SUPPORTED" }) },
    { analysis: relation({ verificationStatus: "NEEDS_CONTEXT", relationType: "MISSING_CONTEXT", missingContext: null }) },
  ])("rejects malformed, ungrounded or inconsistent AI output", async (raw) => {
    await expect(analyzeEvidenceRelation(quotationInput, { analyze: async () => raw })).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });
  it("requires valid immutable-source candidates, unique IDs and truthful surrounding context", () => {
    expect(RelationInputSchema.safeParse({ ...quotationInput, evidence: [hadithEvidence, hadithEvidence] }).success).toBe(false);
    expect(RelationInputSchema.safeParse({ ...quotationInput, originalContent: "some unrelated original" }).success).toBe(false);
    expect(RelationInputSchema.safeParse({ ...quotationInput, evidence: [{ ...hadithEvidence, canonicalUrl: "https://unapproved.test" }] }).success).toBe(false);
    expect(RelationInputSchema.safeParse({ ...quotationInput, claim: { ...quotationInput.claim, isVerifiable: false } }).success).toBe(false);
    expect(RelationResultSchema.safeParse({ analysis: { ...relation(), confidenceScore: 80 } }).success).toBe(false);
  });
  it("maps generic provider failures to a sanitized code", async () => {
    await expect(analyzeEvidenceRelation(quotationInput, { analyze: async () => { throw new Error("private credentials and body"); } })).rejects.toMatchObject({ code: "AI_UNAVAILABLE", message: "AI_UNAVAILABLE" });
  });
  it("preserves fixed provider errors", async () => {
    await expect(analyzeEvidenceRelation(quotationInput, { analyze: async () => { throw new ExtractionError("AI_NOT_CONFIGURED"); } })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });
  it("enforces a deadline even for an uncooperative provider", async () => {
    vi.useFakeTimers(); let signal!: AbortSignal;
    const work = analyzeEvidenceRelation(quotationInput, { analyze: (_, incoming) => { signal = incoming; return new Promise(() => {}); } });
    const rejected = expect(work).rejects.toMatchObject({ code: "AI_TIMEOUT" }); await vi.advanceTimersByTimeAsync(REASONING_TIMEOUT_MS); await rejected;
    expect(signal.aborted).toBe(true);
  });
  it("stops waiting on client cancellation", async () => {
    const abort = new AbortController(); const work = analyzeEvidenceRelation(quotationInput, { analyze: () => new Promise(() => {}) }, abort.signal);
    const rejected = expect(work).rejects.toMatchObject({ code: "AI_TIMEOUT" }); abort.abort(); await rejected;
  });
});
