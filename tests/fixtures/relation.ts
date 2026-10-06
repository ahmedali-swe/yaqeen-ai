import { EvidenceCandidateSchema } from "../../src/evidence/types";
import type { RelationAnalysis, RelationInput } from "../../src/domain/evidence-reasoning";
import corpus from "./hadith.json";
import { claim } from "./claims";

export const hadithEvidence = EvidenceCandidateSchema.parse({ ...corpus[0], relevanceScore: 0.98 });
export const arabicExample = "قال الكاتب: «إنما الأعمال بالنيات»، ثم ذكر أن هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول.";
export const quotationClaim = claim("إنما الأعمال بالنيات", { id: "quote", claimType: "QUOTE" });
export const interpretationClaim = claim("كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول", { id: "interpretation", claimType: "INTERPRETATION" });
export const quotationInput: RelationInput = { claim: quotationClaim, evidence: [hadithEvidence], originalContent: arabicExample };
export function relation(overrides: Partial<RelationAnalysis> = {}): RelationAnalysis {
  return { verificationStatus: "SUPPORTED", relationType: "DIRECT_QUOTE", strongestEvidenceId: hadithEvidence.id,
    supportedMeaning: "ينص الدليل المقدم على ارتباط الأعمال بالنيات، وأن لكل امرئ ما نوى.",
    unsupportedPart: null, missingContext: null, reasoning: "العبارة مقتطف أمين من النص المقدم دون إضافة شرط جديد.", requiresSpecialist: false, ...overrides };
}
