// @vitest-environment node
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { extractClaims } from "../src/ai/claim-extraction";
import { analyzeEvidenceRelation } from "../src/ai/evidence-reasoning";
import { generateYaqeenPatch } from "../src/ai/yaqeen-patch";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { claim } from "./fixtures/claims";
import { evaluationCases } from "../evaluation/cases";
import type { EvidenceCandidate } from "../src/evidence/types";

const text = "Paris is the capital of France.";
const selected = evaluationCases.find((item) => item.id === "comfort-inference")!;
let evidence: EvidenceCandidate[];
beforeAll(async () => { evidence = (await localSahihaynProvider.retrieve({ ...selected.claim, text: "إنما الأعمال بالنيات", claimType: "QUOTE" }, new AbortController().signal)).filter((item) => item.id === selected.evidenceId); });
beforeEach(() => { vi.stubEnv("GROQ_API_KEY", "test-only-key"); vi.stubEnv("AI_PROVIDER", "groq"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const completion = (value: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
const relation = () => ({ verificationStatus: "UNSUPPORTED" as const, relationType: "UNSUPPORTED_INFERENCE" as const, strongestEvidenceId: selected.evidenceId,
  supportedMeaning: "الأعمال بالنيات.", unsupportedPart: selected.claim.text, missingContext: null, reasoning: "لا يربط النص العمل بالراحة النفسية.", requiresSpecialist: false });
const patch = () => ({ action: "PATCH", originalText: selected.claim.text, proposedText: "هذا الحديث يعني أن الأعمال بالنيات", changes: [{ originalSegment: "كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول", replacementSegment: "الأعمال بالنيات", mutationType: "UNSUPPORTED_INFERENCE", reason: "الشرط غير مدعوم بالنص." }], preservedIntent: "بيان صلة الأعمال بالنيات.", evidenceIds: [selected.evidenceId], explanation: "يحذف الاستنتاج غير المدعوم فقط." });

describe("validated service caching across all three AI operations", () => {
  it("deduplicates and caches extraction, preserving original offsets", async () => {
    vi.mocked(fetch).mockImplementation(async () => completion({ claims: [claim(text)] }));
    const [a, b] = await Promise.all([extractClaims(text), extractClaims(text)]);
    expect(a).toEqual(b); await extractClaims(text); expect(fetch).toHaveBeenCalledTimes(1);
    await extractClaims(` ${text}`); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("deduplicates and caches bound reasoning without mutating evidence", async () => {
    const input = { claim: selected.claim, evidence, originalContent: selected.originalContent }, before = JSON.stringify(input);
    vi.mocked(fetch).mockImplementation(async () => completion({ analysis: relation() }));
    await Promise.all([analyzeEvidenceRelation(input), analyzeEvidenceRelation(input)]); await analyzeEvidenceRelation(input);
    expect(fetch).toHaveBeenCalledTimes(1); expect(JSON.stringify(input)).toBe(before);
    await analyzeEvidenceRelation({ ...input, evidence: [{ ...evidence[0], exactText: evidence[0].exactText + " " }] }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("deduplicates and caches authenticated minimum Patch with an unchanged reporting frame", async () => {
    const input = { claim: selected.claim, evidence, originalContent: selected.originalContent, analysis: relation() }, before = JSON.stringify(evidence);
    vi.mocked(fetch).mockImplementation(async () => completion({ patch: patch() }));
    const results = await Promise.all([generateYaqeenPatch(input), generateYaqeenPatch(input)]); await generateYaqeenPatch(input);
    expect(fetch).toHaveBeenCalledTimes(1); expect(results[0].patch.changes).toHaveLength(1);
    expect(results[0].patch.proposedText).toBe("هذا الحديث يعني أن الأعمال بالنيات"); expect(JSON.stringify(evidence)).toBe(before);
  });
  it("never caches syntactically valid but unbound provider output", async () => {
    const input = { claim: selected.claim, evidence, originalContent: selected.originalContent };
    vi.mocked(fetch).mockResolvedValueOnce(completion({ analysis: { ...relation(), strongestEvidenceId: "fabricated" } })).mockResolvedValueOnce(completion({ analysis: relation() }));
    await expect(analyzeEvidenceRelation(input)).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
    await analyzeEvidenceRelation(input); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("performs fresh reasoning for each independent evaluation run", async () => {
    const input = { claim: selected.claim, evidence, originalContent: selected.originalContent };
    vi.mocked(fetch).mockImplementation(async () => completion({ analysis: relation() }));
    for (let i = 0; i < 3; i++) await analyzeEvidenceRelation(input, undefined, undefined, { cache: false });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("still requires valid server configuration before serving cached AI output", async () => {
    vi.mocked(fetch).mockImplementation(async () => completion({ claims: [claim(text)] }));
    await extractClaims(text); vi.stubEnv("GROQ_API_KEY", "");
    await expect(extractClaims(text)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
