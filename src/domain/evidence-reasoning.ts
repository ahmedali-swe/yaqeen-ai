import { z } from "zod";
import { MutationType, VerificationStatus } from "./analysis";
import { ExtractedClaimSchema, type ExtractedClaim } from "./claim-extraction";
import { EvidenceCandidateSchema, type EvidenceCandidate } from "@/evidence/types";
import { MAX_TEXT_LENGTH } from "@/lib/input";
import { normalizeForSearch } from "@/evidence/matching";
import { EvidenceExplanationSchema, type EvidenceExplanation } from "@/evidence/explanations/types";
import { matchExplanation } from "@/evidence/explanations/matching";

export const MAX_REASONING_INPUT_LENGTH = 120_000;
const explanation = z.string().min(1).max(1_500);
export const RelationAnalysisSchema = z.strictObject({
  verificationStatus: z.enum(VerificationStatus),
  relationType: z.enum([...Object.values(MutationType), "NONE"]),
  strongestEvidenceId: z.string().min(1).max(200).nullable(),
  supportedMeaning: explanation,
  unsupportedPart: z.string().min(1).max(MAX_TEXT_LENGTH).nullable(),
  missingContext: explanation.nullable(),
  reasoning: explanation,
  requiresSpecialist: z.boolean(),
});
export const RelationResultSchema = z.strictObject({ analysis: RelationAnalysisSchema });
export type RelationAnalysis = z.infer<typeof RelationAnalysisSchema>;
export type RelationResult = z.infer<typeof RelationResultSchema>;

export const RelationInputSchema = z.strictObject({
  claim: ExtractedClaimSchema,
  evidence: z.array(EvidenceCandidateSchema).max(8),
  originalContent: z.string().min(1).max(MAX_TEXT_LENGTH).optional(),
  approvedExplanations: z.array(EvidenceExplanationSchema).max(8).optional(),
}).superRefine((input, context) => {
  if (!input.claim.text.trim() || !input.claim.isVerifiable) context.addIssue({ code: "custom", message: "A checkable nonempty claim is required", path: ["claim"] });
  if (new Set(input.evidence.map((item) => item.id)).size !== input.evidence.length) context.addIssue({ code: "custom", message: "Evidence IDs must be unique", path: ["evidence"] });
  if (new Set(input.approvedExplanations?.map((item) => item.evidenceId)).size !== (input.approvedExplanations?.length ?? 0) || input.approvedExplanations?.some((explanation) => !input.evidence.some((item) => item.id === explanation.evidenceId && item.sourceType === "HADITH" && matchExplanation(typeof item.metadata.displayText === "string" ? item.metadata.displayText : item.exactText, explanation.exactHadithText, input.originalContent ? /[«“"]([^»”"]+)[»”"]/u.exec(input.originalContent)?.[1] : undefined)))) context.addIssue({ code: "custom", message: "Explanations must match supplied evidence", path: ["approvedExplanations"] });
  if (input.originalContent !== undefined && !input.originalContent.includes(input.claim.text)) context.addIssue({ code: "custom", message: "Surrounding content must contain the original claim", path: ["originalContent"] });
  if (JSON.stringify(input).length > MAX_REASONING_INPUT_LENGTH) context.addIssue({ code: "custom", message: "Reasoning input is too large" });
});
export type RelationInput = z.infer<typeof RelationInputSchema>;
export type ReadonlyRelationInput = Readonly<{
  claim: Readonly<ExtractedClaim>;
  evidence: readonly Readonly<Omit<EvidenceCandidate, "metadata"> & { metadata: Readonly<EvidenceCandidate["metadata"]> }>[];
  originalContent?: string;
  approvedExplanations?: readonly Readonly<EvidenceExplanation>[];
}>;

/** An explicit unique textual reference, not support for an author's inference. */
export function explicitContextEvidenceId(input: Pick<ReadonlyRelationInput, "claim" | "evidence"> & { originalContent?: string }): string | null {
  if (!input.originalContent || !/^هذا الحديث\s+(?:يعني|يدل|يثبت)/u.test(input.claim.text)) return null;
  const quotes = [...input.originalContent.matchAll(/[«“"]([^»”"]+)[»”"]/gu)];
  if (quotes.length !== 1) return null;
  const quotation = normalizeForSearch(quotes[0][1]);
  if (quotation.length < 10) return null;
  const matches = input.evidence.filter((item) => item.sourceType === "HADITH" && normalizeForSearch(item.exactText).includes(quotation));
  return matches.length === 1 ? matches[0].id : null;
}

/** Semantic bindings checked again on the server and before displaying a result. */
export function isBoundRelation(analysis: RelationAnalysis, input: Pick<ReadonlyRelationInput, "claim" | "evidence"> & { originalContent?: string }): boolean {
  const contextEvidenceId = explicitContextEvidenceId(input);
  if (contextEvidenceId !== null && analysis.strongestEvidenceId !== contextEvidenceId && !analysis.requiresSpecialist) return false;
  if (analysis.strongestEvidenceId !== null && !input.evidence.some((item) => item.id === analysis.strongestEvidenceId)) return false;
  if (analysis.unsupportedPart !== null && (!analysis.unsupportedPart.trim() || !input.claim.text.includes(analysis.unsupportedPart))) return false;
  if ([analysis.supportedMeaning, analysis.reasoning, analysis.missingContext].some((value) => value !== null && !value.trim())) return false;
  if ([analysis.supportedMeaning, analysis.reasoning, analysis.missingContext].some((value) => value !== null && !/\p{Script=Arabic}/u.test(value))) return false;
  if (analysis.requiresSpecialist !== (analysis.verificationStatus === "REQUIRES_SPECIALIST")) return false;
  if (analysis.verificationStatus === "SUPPORTED" && (analysis.strongestEvidenceId === null || analysis.unsupportedPart !== null || analysis.missingContext !== null || !["DIRECT_QUOTE", "PARAPHRASE"].includes(analysis.relationType))) return false;
  if (analysis.verificationStatus === "PARTIALLY_SUPPORTED" && (analysis.strongestEvidenceId === null || (!analysis.unsupportedPart && !analysis.missingContext))) return false;
  if (analysis.relationType === "MISSING_CONTEXT" && analysis.missingContext === null) return false;
  if (["OVERGENERALIZATION", "UNSUPPORTED_INFERENCE", "MISATTRIBUTION", "TRANSLATION_DRIFT"].includes(analysis.relationType) && analysis.unsupportedPart === null) return false;
  if (!input.evidence.length && (analysis.strongestEvidenceId !== null || ["SUPPORTED", "PARTIALLY_SUPPORTED"].includes(analysis.verificationStatus))) return false;
  return true;
}
