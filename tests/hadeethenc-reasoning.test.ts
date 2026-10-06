// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import * as explanations from "../src/evidence/explanations/hadeethenc";
import { analyzeEvidenceRelation } from "../src/ai/evidence-reasoning";
import { generateYaqeenPatch } from "../src/ai/yaqeen-patch";
import { isEvidenceBoundedInferencePatch, applyPatchChanges, type Patch } from "../src/domain/yaqeen-patch";
import { RelationInputSchema } from "../src/domain/evidence-reasoning";
import { resolveClaimEvidence } from "../src/evidence/resolve";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import type { EvidenceCandidate } from "../src/evidence/types";
import { bukhari71Content, bukhari71Quote, bukhari71Conclusion } from "./fixtures/bukhari-71";
import { quotationInput, interpretationClaim, relation } from "./fixtures/relation";
import { officialDetails } from "./fixtures/hadeethenc-transport";
import { PATCH_INSTRUCTIONS } from "../src/ai/patch-prompt";
import { EVIDENCE_REASONING_INSTRUCTIONS } from "../src/ai/evidence-reasoning-prompt";

let evidence: EvidenceCandidate[];
beforeAll(async () => { evidence = (await localSahihaynProvider.retrieve(bukhari71Quote, new AbortController().signal)).filter(x => x.id === "sahihayn-bukhari-71"); });
afterEach(() => vi.restoreAllMocks());
const unsupported = () => relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", strongestEvidenceId: evidence[0].id, supportedMeaning: "الشرح يذكر فهم الدين؛ لا يذكر اشتراط التخصص أو العلم الواسع.", unsupportedPart: bukhari71Conclusion.text, reasoning: "الادعاء أضاف شرط التخصص أو العلم الواسع الذي لا يثبته النص والشرح المقدم." });
const input = () => ({ claim: bukhari71Conclusion, evidence, originalContent: bukhari71Content });
const proposed = "لا يكفي هذا الحديث للاستدلال على أن عدم التخصص في الفقه أو قلة العلم الشرعي دليل على أن الله لا يريد بالمرء خيرًا";
const patch = (text = proposed): Patch => ({ action: "PATCH", originalText: bukhari71Conclusion.text, proposedText: text,
  changes: [{ originalSegment: bukhari71Conclusion.text, replacementSegment: text, mutationType: "UNSUPPORTED_INFERENCE", reason: "تقييد الاستدلال بدل إثبات نقيض ديني غير مستند إلى الشرح." }],
  evidenceIds: [evidence[0].id], preservedIntent: "الإبقاء على موضوع الاستنتاج مع بيان حدود الدليل.", explanation: "الشرح يذكر فهم الدين ولا يثبت أن التخصص أو العلم الواسع شرط لإرادة الخير." });

it("anchors Bukhari 71 explanation context, independently analyzes both claims, and never copies a verdict", async () => {
  const context = { originalContent: bukhari71Content, claims: [bukhari71Quote, bukhari71Conclusion], evidenceAnchorClaimId: bukhari71Quote.id };
  const retrieve = vi.fn().mockResolvedValueOnce({ evidence: [] }).mockResolvedValueOnce({ evidence });
  const resolution = await resolveClaimEvidence(bukhari71Conclusion, context, undefined, retrieve);
  const enriched = await explanations.withApprovedExplanations(resolution, bukhari71Quote.text);
  expect(enriched.resolution).toEqual({ evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: bukhari71Quote.id });
  expect(enriched.explanations?.[0]).toMatchObject({ evidenceId: evidence[0].id, sourceId: officialDetails[1].id, exactExplanation: officialDetails[1].explanation });
  expect(enriched).not.toHaveProperty("analysis");
  const provider = { analyze: vi.fn().mockResolvedValueOnce({ analysis: relation({ strongestEvidenceId: evidence[0].id }) }).mockResolvedValueOnce({ analysis: unsupported() }) };
  const quote = await analyzeEvidenceRelation({ ...input(), claim: bukhari71Quote }, provider);
  const conclusion = await analyzeEvidenceRelation(input(), provider);
  expect(quote.analysis).toMatchObject({ verificationStatus: "SUPPORTED", relationType: "DIRECT_QUOTE" });
  expect(conclusion.analysis).toMatchObject({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE" });
  expect(provider.analyze).toHaveBeenCalledTimes(2);
  expect(provider.analyze.mock.calls[0][0].approvedExplanations).toEqual(provider.analyze.mock.calls[1][0].approvedExplanations);
  expect(provider.analyze.mock.calls[1][0]).not.toHaveProperty("analysis");
});
it("passes exact approved text through one existing reasoning call, keeping all sources immutable", async () => {
  const before = JSON.stringify(evidence), provider = { analyze: vi.fn().mockResolvedValue({ analysis: unsupported() }) };
  await analyzeEvidenceRelation(input(), provider);
  const sent = provider.analyze.mock.calls[0][0];
  expect(sent.approvedExplanations[0].exactExplanation).toBe(officialDetails[1].explanation);
  expect(sent.approvedExplanations[0].reference).toBe(officialDetails[1].reference);
  expect(Object.isFrozen(sent.approvedExplanations[0])).toBe(true); expect(Object.isFrozen(sent.approvedExplanations[0].hints)).toBe(true);
  expect(provider.analyze).toHaveBeenCalledOnce(); expect(JSON.stringify(evidence)).toBe(before);
});
it("re-resolves caller approval metadata server-side rather than trusting invented explanations", async () => {
  const approved = await explanations.resolveApprovedExplanations(evidence), provider = { analyze: vi.fn().mockResolvedValue({ analysis: unsupported() }) };
  const forged = approved.explanations.map(x => ({ ...x, exactExplanation: "نص ديني مختلق من المتصفح" }));
  await analyzeEvidenceRelation({ ...input(), approvedExplanations: forged }, provider);
  expect(provider.analyze.mock.calls[0][0].approvedExplanations[0].exactExplanation).toBe(officialDetails[1].explanation);
});
it.each(["UNAVAILABLE", "NO_APPROVED_EXPLANATION"] as const)("restricts interpretation reasoning with %s and makes zero AI calls", async (explanationStatus) => {
  vi.spyOn(explanations, "resolveApprovedExplanations").mockResolvedValue({ explanations: [], explanationStatus });
  const provider = { analyze: vi.fn() };
  const result = await analyzeEvidenceRelation(input(), provider);
  expect(result.analysis).toMatchObject({ verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", reasoning: "لم يتوفر شرح معتمد كافٍ لتقييم هذا التفسير بثقة." });
  expect(provider.analyze).not.toHaveBeenCalled();
});
it("keeps exact-quote comparison available without an explanation", async () => {
  vi.spyOn(explanations, "resolveApprovedExplanations").mockResolvedValue({ explanations: [], explanationStatus: "UNAVAILABLE" });
  const provider = { analyze: vi.fn().mockResolvedValue({ analysis: relation({ strongestEvidenceId: evidence[0].id }) }) };
  expect((await analyzeEvidenceRelation({ ...input(), claim: bukhari71Quote }, provider)).analysis.verificationStatus).toBe("SUPPORTED");
  expect(provider.analyze.mock.calls[0][0].approvedExplanations).toEqual([]);
});
it("an explanation for another evidence ID cannot authorize interpreting an unexplained hadith", async () => {
  const other = await explanations.resolveApprovedExplanations(quotationInput.evidence);
  vi.spyOn(explanations, "resolveApprovedExplanations").mockResolvedValue(other);
  const provider = { analyze: vi.fn().mockResolvedValue({ analysis: unsupported() }) };
  const result = await analyzeEvidenceRelation({ ...input(), evidence: [...evidence, ...quotationInput.evidence] }, provider);
  expect(result.analysis).toMatchObject({ verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: evidence[0].id });
});
it("carries source unavailability without rejecting the whole evidence result", async () => {
  // Resolver failure is data, while the immutable primary evidence is retained.
  const result = await explanations.createHadeethEncResolver({ fetcher: async () => { throw new Error("offline"); } }).resolve(evidence[0]);
  expect(result).toEqual({ explanation: null, status: "UNAVAILABLE" }); expect(evidence[0].exactText).toContain("يُفَقِّهْهُ");
});
it("binds explanations to the correct actual hadith, not merely an ID or collection", async () => {
  const { explanations: approved } = await explanations.resolveApprovedExplanations(evidence);
  expect(RelationInputSchema.safeParse({ ...input(), approvedExplanations: approved }).success).toBe(true);
  expect(RelationInputSchema.safeParse({ ...input(), approvedExplanations: [{ ...approved[0], evidenceId: "unknown" }] }).success).toBe(false);
  expect(RelationInputSchema.safeParse({ ...input(), approvedExplanations: [{ ...approved[0], exactHadithText: "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى" }] }).success).toBe(false);
});
it("passes the approved explanation to Patch without another reasoning/summarization call", async () => {
  const before = JSON.stringify(evidence), provider = { generate: vi.fn().mockResolvedValue({ patch: patch() }) };
  const result = await generateYaqeenPatch({ ...input(), analysis: unsupported() }, provider);
  expect(result.patch.action).toBe("PATCH"); expect(result.patch.proposedText).toBe(proposed);
  expect(applyPatchChanges(result.patch.originalText, result.patch.changes)).toBe(proposed);
  expect(provider.generate.mock.calls[0][0].approvedExplanations[0].exactExplanation).toBe(officialDetails[1].explanation);
  expect(provider.generate).toHaveBeenCalledOnce(); expect(JSON.stringify(evidence)).toBe(before);
});
it.each(["الله يريد الخير لكل من لم يتخصص في الفقه", "عدم التخصص في الفقه دليل على إرادة الله الخير", "هذا الاستنتاج غير صحيح شرعًا"])("rejects an unsupported opposite or unqualified judgment in Patch: %s", async (text) => {
  const approved = await explanations.resolveApprovedExplanations(evidence);
  expect(isEvidenceBoundedInferencePatch(patch(text), { ...input(), analysis: unsupported(), approvedExplanations: approved.explanations })).toBe(false);
  const provider = { generate: vi.fn().mockResolvedValue({ patch: patch(text) }) };
  expect((await generateYaqeenPatch({ ...input(), analysis: unsupported() }, provider)).patch.action).toBe("NO_SAFE_PATCH");
});
it("does not invent a Patch for an interpretation without an approved explanation", async () => {
  vi.spyOn(explanations, "resolveApprovedExplanations").mockResolvedValue({ explanations: [], explanationStatus: "UNAVAILABLE" });
  const provider = { generate: vi.fn() };
  expect((await generateYaqeenPatch({ ...input(), analysis: unsupported() }, provider)).patch).toMatchObject({ action: "NO_SAFE_PATCH", explanation: "لم يتوفر شرح معتمد كافٍ لتقييم هذا التفسير بثقة." });
  expect(provider.generate).not.toHaveBeenCalled();
});
it("keeps quote+interpretation explanation provenance separate from supplied evidence and AI output", async () => {
  const result = await explanations.withApprovedExplanations({ evidence: quotationInput.evidence }, quotationInput.claim.text);
  expect(result.evidence).toEqual(quotationInput.evidence); expect(result.explanations?.[0].exactExplanation).toBe(officialDetails[0].explanation);
  const provider = { analyze: vi.fn().mockResolvedValue({ analysis: relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: interpretationClaim.text }) }) };
  await analyzeEvidenceRelation({ ...quotationInput, claim: interpretationClaim }, provider);
  expect(provider.analyze).toHaveBeenCalledOnce(); expect(provider.analyze.mock.calls[0][0].evidence).toEqual(quotationInput.evidence);
});
it("explicitly instructs both existing AI operations to avoid independent religious interpretation", () => {
  for (const prompt of [EVIDENCE_REASONING_INSTRUCTIONS, PATCH_INSTRUCTIONS]) expect(prompt).toContain("Do not independently interpret the hadith beyond the supplied evidence and approved explanation.");
  expect(PATCH_INSTRUCTIONS).toContain("lack of support NEVER proves the opposite");
});
