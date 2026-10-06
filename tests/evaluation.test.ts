// @vitest-environment node
import { describe, expect, it } from "vitest";
import { evaluationCases } from "../evaluation/cases";
import { baselineStatus, measure, measureStability, type EvaluationObservation } from "../evaluation/metrics";
import { relation } from "./fixtures/relation";
import { requiresPersonalSpecialist } from "../src/domain/specialist-boundary";
import { analyzeEvidenceRelation } from "../src/ai/evidence-reasoning";
import { generateYaqeenPatch } from "../src/ai/yaqeen-patch";
import { SequentialAiRunner, parseEvaluationArgs } from "../evaluation/runner";
import { afterEach, vi } from "vitest";

afterEach(() => vi.useRealTimers());

describe("measurable evaluation and specialist boundary", () => {
  it("has ten predeclared cases, approved traceable references, labels and an evaluation-only baseline", () => {
    expect(evaluationCases).toHaveLength(10); expect(new Set(evaluationCases.map((item) => item.id)).size).toBe(10);
    for (const item of evaluationCases) {
      expect(item.labelRationale).not.toBe(""); expect(item.referenceReview).not.toBe("");
      if (item.evidenceId) expect(item.canonicalUrl).toMatch(/^https:\/\/sunnah\.com\/(bukhari|muslim):/);
    }
    expect(evaluationCases.filter((item) => baselineStatus(item) === item.expected.verificationStatus)).toHaveLength(5);
  });
  it("separates unavailable providers from semantic accuracy and keeps failed calls visible", () => {
    const patch = { action: "NO_SAFE_PATCH" as const, originalText: "إنما الأعمال بالنيات", proposedText: null, changes: [], preservedIntent: "محفوظ", evidenceIds: [], explanation: "لا يحتاج لتغيير" };
    const observations: EvaluationObservation[] = [{ caseId: "exact-quote", run: 1, analysis: relation(), patch, referenceValid: true, providerAttempts: 1 }, { caseId: "exact-quote", run: 2, error: "AI_UNAVAILABLE", referenceValid: false, providerAttempts: 3 }];
    const measured = measure(evaluationCases, observations);
    expect(measured.semanticPerformance.statusClassificationAccuracy).toEqual({ correct: 1, total: 1, rate: 1 });
    expect(measured.semanticPerformance.mutationClassificationAccuracy).toEqual({ correct: 1, total: 1, rate: 1 });
    expect(measured.semanticPerformance.patchDecisionAccuracy).toEqual({ correct: 1, total: 1, rate: 1 });
    expect(measured.providerAvailability).toMatchObject({ attemptedAiObservations: 2, successfulObservations: 1, providerFailures: 1, actualHttpAttempts: 4, availabilityRate: { correct: 1, total: 2, rate: 0.5 } });
    expect(measured.endToEnd.successRate).toEqual({ correct: 1, total: 2, rate: 0.5 });
    expect(measureStability(evaluationCases.slice(0, 1), observations)[0]).toMatchObject({ expectedMatches: 1, agreement: false });
  });
  it("keeps valid reasoning when Patch fails and distinguishes malformed output from transport", () => {
    const observations: EvaluationObservation[] = [
      { caseId: "exact-quote", run: 1, analysis: relation(), error: "AI_UNAVAILABLE", referenceValid: true, providerAttempts: 3 },
      { caseId: "exact-quote", run: 2, error: "INVALID_AI_RESPONSE", referenceValid: false, providerAttempts: 1 },
    ];
    const result = measure(evaluationCases, observations);
    expect(result.semanticPerformance.statusClassificationAccuracy).toEqual({ correct: 1, total: 1, rate: 1 });
    expect(result.semanticPerformance.patchDecisionAccuracy.rate).toBeNull();
    expect(result.providerAvailability).toMatchObject({ providerFailures: 1, invalidOutputFailures: 1, successfulObservations: 0 });
  });
  it("does not turn a wrong but available classification into a provider failure", () => {
    const output = { caseId: "exact-quote", run: 1, analysis: relation({ verificationStatus: "UNSUPPORTED" }), referenceValid: true, providerAttempts: 1 };
    const measured = measure(evaluationCases, [output]);
    expect(measured.providerAvailability.providerFailures).toBe(0);
    expect(measured.semanticPerformance.statusClassificationAccuracy).toEqual({ correct: 0, total: 1, rate: 0 });
  });
  it("keeps deterministic referral separate from live provider observations", async () => {
    const selected = evaluationCases.find((item) => item.id === "specialist")!, input = { claim: selected.claim, evidence: [] };
    const analyzed = await analyzeEvidenceRelation(input), patched = await generateYaqeenPatch({ ...input, analysis: analyzed.analysis });
    const measured = measure(evaluationCases, [{ caseId: selected.id, run: 1, analysis: analyzed.analysis, patch: patched.patch, referenceValid: true, providerAttempts: 0 }]);
    expect(measured.providerAvailability.attemptedAiObservations).toBe(0); expect(measured.providerAvailability.availabilityRate.rate).toBeNull();
    expect(measured.semanticPerformance.aiReasoningOnly.statusClassificationAccuracy.rate).toBeNull();
    expect(measured.semanticPerformance.abstentionAccuracy.rate).toBe(1); expect(measured.endToEnd.deterministicObservations).toBe(1);
  });
  it("runs queued AI calls sequentially with a delay, even when submitted concurrently", async () => {
    vi.useFakeTimers(); const runner = new SequentialAiRunner(100); const order: string[] = []; let active = 0, maximum = 0;
    const task = (id: number) => runner.run(async () => { active++; maximum = Math.max(maximum, active); order.push(`start-${id}`); await new Promise((resolve) => setTimeout(resolve, 50)); order.push(`end-${id}`); active--; });
    const pending = [task(1), task(2), task(3)];
    await vi.advanceTimersByTimeAsync(149); expect(order).toEqual(["start-1", "end-1"]);
    await vi.advanceTimersByTimeAsync(500); await Promise.all(pending);
    expect(maximum).toBe(1); expect(order).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
  });
  it("preserves every case by default and makes independent three-run work sequential", () => {
    expect(parseEvaluationArgs([])).toEqual({ runs: 1, delayMs: 2_000, keyCases: false });
    expect(parseEvaluationArgs(["--", "--runs", "3", "--delay-ms", "20000"])).toEqual({ runs: 3, delayMs: 20_000, keyCases: true });
    expect(() => parseEvaluationArgs(["--runs", "0"])).toThrow();
    expect(() => parseEvaluationArgs(["--delay-ms", "99999"])).toThrow();
    expect(() => parseEvaluationArgs(["--runs", "2", "--runs", "3"])).toThrow();
  });
  it("routes explicit personal religious applications to a specialist even when a model could classify them differently", async () => {
    const selected = evaluationCases.find((item) => item.id === "specialist")!;
    expect(requiresPersonalSpecialist(selected.claim)).toBe(true);
    const input = { claim: selected.claim, evidence: [] };
    const provider = { analyze: () => { throw new Error("must not invoke model"); } };
    const result = await analyzeEvidenceRelation(input, provider);
    expect(result.analysis).toMatchObject({ verificationStatus: "REQUIRES_SPECIALIST", relationType: "NONE", requiresSpecialist: true });
    expect((await generateYaqeenPatch({ ...input, analysis: result.analysis })).patch.action).toBe("REFER_SPECIALIST");
  });
  it("does not mistake generic quotations or interpretation for personal fatwa", () => {
    for (const id of ["exact-quote", "comfort-inference", "faithful-paraphrase"]) expect(requiresPersonalSpecialist(evaluationCases.find((item) => item.id === id)!.claim)).toBe(false);
  });
  it("handles English personal religious application without issuing a ruling", () => {
    expect(requiresPersonalSpecialist({ text: "Is my prayer valid in my situation?", claimType: "RULING" })).toBe(true);
  });
});
