import type { EvaluationCase } from "./cases";
import type { RelationAnalysis } from "../src/domain/evidence-reasoning";
import type { Patch } from "../src/domain/yaqeen-patch";

export type EvaluationObservation = { caseId: string; run: number; analysis?: RelationAnalysis; patch?: Patch; referenceValid: boolean; error?: string; providerAttempts: number; providerStatus?: number };
const metric = (correct: number, total: number) => ({ correct, total, rate: total ? correct / total : null });
const providerError = (error?: string) => error === "AI_UNAVAILABLE" || error === "AI_TIMEOUT";
/** Baseline exists ONLY here: passage present -> SUPPORTED, otherwise NEEDS_CONTEXT. */
export function baselineStatus(item: EvaluationCase) { return item.evidenceId === null ? "NEEDS_CONTEXT" : "SUPPORTED"; }
export function measure(cases: EvaluationCase[], observations: EvaluationObservation[]) {
  const matched = observations.map((observation) => {
    const item = cases.find((item) => item.id === observation.caseId);
    if (!item) throw new Error("Unknown evaluation case");
    return { observation, item };
  });
  const attempted = matched.filter(({ observation }) => observation.providerAttempts > 0);
  const completed = matched.filter(({ observation }) => observation.analysis && observation.patch && !observation.error);
  const reasoning = matched.filter(({ observation }) => observation.analysis !== undefined);
  const aiReasoning = reasoning.filter(({ observation }) => observation.providerAttempts > 0);
  const patches = matched.filter(({ observation }) => observation.patch !== undefined);
  const inference = reasoning.filter(({ item }) => item.expected.mutationType === "UNSUPPORTED_INFERENCE");
  const abstention = completed.filter(({ item }) => item.expected.patchAction !== "PATCH" && ["NEEDS_CONTEXT", "REQUIRES_SPECIALIST"].includes(item.expected.verificationStatus));
  const statusCorrect = ({ item, observation }: typeof matched[number]) => observation.analysis?.verificationStatus === item.expected.verificationStatus;
  const mutationCorrect = ({ item, observation }: typeof matched[number]) => observation.analysis?.relationType === item.expected.mutationType;
  const patchCorrect = ({ item, observation }: typeof matched[number]) => observation.patch?.action === item.expected.patchAction && (observation.patch.action === "PATCH") === item.expected.patchAllowed;
  return {
    providerAvailability: {
      attemptedAiObservations: attempted.length,
      successfulObservations: attempted.filter(({ observation }) => observation.analysis && observation.patch && !observation.error).length,
      providerFailures: attempted.filter(({ observation }) => providerError(observation.error)).length,
      invalidOutputFailures: attempted.filter(({ observation }) => observation.error === "INVALID_AI_RESPONSE").length,
      otherFailures: attempted.filter(({ observation }) => observation.error && !providerError(observation.error) && observation.error !== "INVALID_AI_RESPONSE").length,
      availabilityRate: metric(attempted.filter(({ observation }) => observation.analysis && observation.patch && !observation.error).length, attempted.length),
      actualHttpAttempts: observations.reduce((total, observation) => total + observation.providerAttempts, 0),
    },
    semanticPerformance: {
      // Stage-specific denominators retain a valid relation even if Patch fails.
      statusClassificationAccuracy: metric(reasoning.filter(statusCorrect).length, reasoning.length),
      mutationClassificationAccuracy: metric(reasoning.filter(mutationCorrect).length, reasoning.length),
      aiReasoningOnly: {
        statusClassificationAccuracy: metric(aiReasoning.filter(statusCorrect).length, aiReasoning.length),
        mutationClassificationAccuracy: metric(aiReasoning.filter(mutationCorrect).length, aiReasoning.length),
      },
      unsupportedInferenceDetection: metric(inference.filter(({ observation }) => observation.analysis?.relationType === "UNSUPPORTED_INFERENCE" && observation.analysis.verificationStatus === "UNSUPPORTED").length, inference.length),
      abstentionAccuracy: metric(abstention.filter(({ item, observation }) => observation.analysis?.verificationStatus === item.expected.verificationStatus && observation.patch?.action === item.expected.patchAction && observation.patch.proposedText === null).length, abstention.length),
      evidenceReferenceValidity: metric(reasoning.filter(({ observation }) => observation.referenceValid).length, reasoning.length),
      patchDecisionAccuracy: metric(patches.filter(patchCorrect).length, patches.length),
      pairedBaselineStatusAccuracy: metric(reasoning.filter(({ item }) => baselineStatus(item) === item.expected.verificationStatus).length, reasoning.length),
    },
    endToEnd: {
      totalObservations: matched.length,
      completedObservations: completed.length,
      completionRate: metric(completed.length, matched.length),
      // SYSTEM success includes both availability and expected outcomes.
      successRate: metric(completed.filter((pair) => statusCorrect(pair) && mutationCorrect(pair) && patchCorrect(pair) && pair.observation.referenceValid).length, matched.length),
      failedObservations: matched.filter(({ observation }) => observation.error !== undefined).length,
      deterministicObservations: matched.filter(({ observation }) => observation.providerAttempts === 0 && observation.analysis && observation.patch && !observation.error).length,
    },
  };
}
export function measureStability(cases: EvaluationCase[], observations: EvaluationObservation[]) {
  return cases.map((item) => {
    const runs = observations.filter((observation) => observation.caseId === item.id);
    const labels = runs.map((run) => run.analysis ? `${run.analysis.verificationStatus}/${run.analysis.relationType}` : "NO_VALID_CLASSIFICATION");
    return { caseId: item.id, runs: runs.length, successfulReasoningRuns: runs.filter((run) => run.analysis).length,
      expectedMatches: runs.filter((run) => run.analysis?.verificationStatus === item.expected.verificationStatus && run.analysis?.relationType === item.expected.mutationType).length,
      agreement: runs.length > 0 && runs.every((run) => run.analysis) && new Set(labels).size === 1, classifications: labels };
  });
}
