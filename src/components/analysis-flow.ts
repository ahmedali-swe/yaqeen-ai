import type { EvidenceResult } from "@/evidence/types";
import type { RelationAnalysis } from "@/domain/evidence-reasoning";
import type { Patch } from "@/domain/yaqeen-patch";

export type ClaimFlowState = { evidenceResult?: EvidenceResult; analysis?: RelationAnalysis; patch?: Patch };
export type AnalysisStage = "claims" | "evidence" | "relation" | "meaning" | "patch";
export const ANALYSIS_STAGES: AnalysisStage[] = ["claims", "evidence", "relation", "meaning", "patch"];
export type ReportState = { selectedClaimId: string; states: Record<string, ClaimFlowState>; activeStages: Record<string, AnalysisStage> };
export const emptyReport = (): ReportState => ({ selectedClaimId: "", states: {}, activeStages: {} });

export function stageAvailability(state: ClaimFlowState, extracted: boolean, hasClaims: boolean): Record<AnalysisStage, boolean> {
  return { claims: extracted, evidence: hasClaims, relation: !!state.evidenceResult,
    meaning: !!state.analysis && !hasInsufficientEvidence(state) && state.analysis.relationType !== "NONE",
    patch: !!state.analysis && !hasInsufficientEvidence(state) };
}
export function nextStage(state: ClaimFlowState): AnalysisStage {
  return state.patch ? "patch" : state.analysis ? "relation" : state.evidenceResult ? "relation" : "evidence";
}
/** Meaning drift is derived from analysis; invalidating it also invalidates its
 * reasoning source. Evidence and other claims remain untouched. */
export function invalidateStage(state: ClaimFlowState, stage: AnalysisStage): ClaimFlowState {
  if (stage === "claims" || stage === "evidence") return {};
  if (stage === "relation" || stage === "meaning") return state.evidenceResult ? { evidenceResult: state.evidenceResult } : {};
  return { ...state, patch: undefined };
}

export const INSUFFICIENT_EVIDENCE_MESSAGE = "لا يمكن تقييم تحوّل المعنى أو اقتراح تصحيح موثوق لعدم توفر دليل كافٍ.";
export function hasInsufficientEvidence(state: ClaimFlowState): boolean {
  return !!state.analysis && !state.analysis.requiresSpecialist && (!state.evidenceResult?.evidence.length || state.analysis.relationType === "NONE" || !state.evidenceResult.evidence.some((item) => item.id === state.analysis?.strongestEvidenceId));
}
