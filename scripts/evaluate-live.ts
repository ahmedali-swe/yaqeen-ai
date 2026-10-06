import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluationCases, stabilityCaseIds } from "../evaluation/cases";
import { measure, measureStability, type EvaluationObservation } from "../evaluation/metrics";
import { SequentialAiRunner, parseEvaluationArgs } from "../evaluation/runner";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { analyzeEvidenceRelation } from "../src/ai/evidence-reasoning";
import { generateYaqeenPatch } from "../src/ai/yaqeen-patch";
import { requireGroqEnv } from "../src/lib/env";
import { requiresPersonalSpecialist } from "../src/domain/specialist-boundary";
import type { EvidenceCandidate } from "../src/evidence/types";

loadEnvConfig(process.cwd());
process.env.DORAR_ENABLED = "false";
const { runs, delayMs, keyCases } = parseEvaluationArgs(process.argv.slice(2));
const cases = keyCases ? evaluationCases.filter((item) => stabilityCaseIds.includes(item.id)) : evaluationCases;
const observations: EvaluationObservation[] = [];
const runner = new SequentialAiRunner(delayMs);
const references = new Map<string, EvidenceCandidate[]>();
let lastProviderStatus = 0, providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...input) => {
  const groq = String(input[0]) === "https://api.groq.com/openai/v1/chat/completions";
  if (groq) { providerCalls++; lastProviderStatus = 0; }
  const response = await originalFetch(...input);
  if (groq) lastProviderStatus = response.status;
  return response;
};

async function main() {
  requireGroqEnv(process.env);
  console.log(`Live evaluation: ${cases.length} cases x ${runs} run(s), concurrency 1, delay ${delayMs}ms, result cache bypassed.`);
  for (let run = 1; run <= runs; run++) for (const item of cases) {
    const observation: EvaluationObservation = { caseId: item.id, run, referenceValid: false, providerAttempts: 0 };
    const callsBefore = providerCalls;
    lastProviderStatus = 0;
    try {
      const referenceKey = JSON.stringify([item.evidenceQuery, item.evidenceId]);
      let evidence = references.get(referenceKey);
      if (!evidence) {
        const candidates = item.evidenceQuery === null ? [] : await localSahihaynProvider.retrieve({ ...item.claim, text: item.evidenceQuery, claimType: "QUOTE" }, new AbortController().signal);
        evidence = candidates.filter((candidate) => candidate.id === item.evidenceId);
        if (item.evidenceId && (evidence.length !== 1 || evidence[0].reference !== item.reference || evidence[0].canonicalUrl !== item.canonicalUrl)) throw new Error("REFERENCE_MISMATCH");
        references.set(referenceKey, evidence);
      }
      const input = { claim: item.claim, evidence, ...(item.originalContent ? { originalContent: item.originalContent } : {}) };
      const analyze = () => analyzeEvidenceRelation(input, undefined, undefined, { cache: false });
      const analyzed = evidence.length && !requiresPersonalSpecialist(item.claim) ? await runner.run(analyze) : await analyze();
      observation.analysis = analyzed.analysis;
      observation.referenceValid = observation.analysis.strongestEvidenceId === item.evidenceId || (item.id === "specialist" && observation.analysis.strongestEvidenceId === null);
      const patchInput = { ...input, analysis: observation.analysis };
      const patch = () => generateYaqeenPatch(patchInput, undefined, undefined, { cache: false });
      const deterministic = ["SUPPORTED", "REQUIRES_SPECIALIST"].includes(observation.analysis.verificationStatus) || observation.analysis.relationType === "NONE";
      observation.patch = (deterministic ? await patch() : await runner.run(patch)).patch;
      console.log(JSON.stringify({ caseId: item.id, run, actualStatus: observation.analysis.verificationStatus, actualMutation: observation.analysis.relationType, patchAction: observation.patch.action, referenceValid: observation.referenceValid }));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "EVALUATION_FAILED";
      observation.error = /^(AI_NOT_CONFIGURED|AI_TIMEOUT|AI_UNAVAILABLE|INVALID_AI_RESPONSE)$/.test(code) ? code : "EVALUATION_FAILED";
      console.log(JSON.stringify({ caseId: item.id, run, error: observation.error, providerStatus: lastProviderStatus }));
    }
    observation.providerAttempts = providerCalls - callsBefore;
    if (observation.providerAttempts) observation.providerStatus = lastProviderStatus;
    observations.push(observation);
  }
  const report = { methodologyVersion: 2, recordedAt: new Date().toISOString(), model: "openai/gpt-oss-120b", scope: runs > 1 ? "key-case-stability" : keyCases ? "key-case-smoke" : "full-labeled-suite", labelVersion: 1,
    caseCount: cases.length, runs, concurrency: 1, delayMs, resultCache: "bypassed",
    method: "Fixed manually reviewed approved reference per case; real reasoning and Patch; sequential shared bounded retries. Availability, valid-stage semantics and end-to-end success reported separately. No extraction benchmark or test mocks.",
    metrics: measure(cases, observations), stability: runs > 1 ? measureStability(cases, observations) : null, observations };
  await mkdir(resolve(process.cwd(), "docs/evaluation"), { recursive: true });
  const filename = runs > 1 ? "stability-results.json" : keyCases ? "key-live-results.json" : "live-results.json";
  await writeFile(resolve(process.cwd(), "docs/evaluation", filename), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ metrics: report.metrics, stability: report.stability }, null, 2));
  if (observations.some((item) => item.error)) process.exitCode = 1;
}
main().catch(() => { console.error("Live evaluation could not start; check server-side configuration. No secrets or fake scores emitted."); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
