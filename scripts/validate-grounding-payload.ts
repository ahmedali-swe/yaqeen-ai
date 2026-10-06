import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { ClaimExtractionResultSchema } from "../src/domain/claim-extraction";
import { EvidenceResultSchema } from "../src/evidence/types";
import { RelationResultSchema } from "../src/domain/evidence-reasoning";
import { PatchResultSchema } from "../src/domain/yaqeen-patch";
import { reasoningRequest } from "../src/ai/providers/groq-reasoning";
import { patchRequest } from "../src/ai/providers/groq-patch";
import { prepareGroundingRequest, requestMeasurements } from "../src/ai/groq-request";
import { bukhari71Content } from "../tests/fixtures/bukhari-71";

/** Actual HTTP flow, sequential/fail-fast, one public example. No direct Groq
 * requests, no secrets, no replacement of previous baseline/failure records. */
async function main() {
  const base = process.argv[2] ?? "http://127.0.0.1:3107";
  const url = new URL(base);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Local validation only");
  const observations: Record<string, unknown> = { recordedAt: new Date().toISOString(), mode: "Actual local HTTP endpoints, sequential public Bukhari 71 flow", requests: [] };
  const reference71 = process.argv.includes("--reference-71");
  const artifact = reference71 ? "docs/payload/live-bukhari-71-reference.json" : "docs/payload/live-bukhari-71.json";
  if (reference71) observations.mode = "Actual HTTP reference regression: Bukhari 71 selected from real retrieved candidates; normal ranking run recorded separately";
  const previous = await readFile(artifact, "utf8").then(text => JSON.parse(text)).catch(() => null);
  if (previous) observations.previousAttempts = [...(previous.previousAttempts ?? []), { recordedAt: previous.recordedAt, requests: previous.requests, blocker: previous.blocker ?? null }];
  async function post(stage: string, payload: unknown) {
    const response = await fetch(`${url.origin}/api/analyze/${stage}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
    const observation: { stage: string; status: number; errorCode?: string } = { stage, status: response.status };
    (observations.requests as unknown[]).push(observation);
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      const code = failure?.error?.code;
      if (["AI_UNAVAILABLE", "INVALID_AI_RESPONSE", "AI_TIMEOUT", "AI_NOT_CONFIGURED", "RATE_LIMITED", "INVALID_INPUT"].includes(code)) observation.errorCode = code;
      throw new Error(`HTTP_${stage}_${response.status}`);
    }
    return response.json();
  }
  try {
    const extracted = ClaimExtractionResultSchema.parse(await post("claims", { text: bukhari71Content }));
    observations.claims = extracted.claims;
    const quote = extracted.claims.find(item => item.claimType === "QUOTE"), inference = extracted.claims.find(item => item.claimType === "INTERPRETATION");
    if (!quote || !inference) throw new Error("EXTRACTION_SPLIT_UNAVAILABLE");
    for (const selected of [quote, inference]) {
      const evidenceResult = EvidenceResultSchema.parse(await post("evidence", { claim: selected, context: { claims: extracted.claims, originalContent: bukhari71Content } }));
      const evidence = reference71 ? evidenceResult.evidence.filter(item => item.id === "sahihayn-bukhari-71") : evidenceResult.evidence;
      if (!evidence.length) throw new Error("REFERENCE_71_UNAVAILABLE");
      const input = { claim: selected, evidence, approvedExplanations: evidenceResult.explanations?.filter(item => evidence.some(candidate => candidate.id === item.evidenceId)), originalContent: bukhari71Content };
      const options = reasoningRequest(input), serialized = prepareGroundingRequest(options, "openai/gpt-oss-120b");
      const measured = requestMeasurements({ ...options, input: JSON.parse(serialized).messages[1].content }, serialized);
      await delay(20_000);
      const relation = RelationResultSchema.parse(await post("relation", input));
      observations[selected === quote ? "quote" : "inference"] = { resolution: evidenceResult.resolution, approvedSourceIds: evidenceResult.explanations?.map(item => ({ evidenceId: item.evidenceId, sourceId: item.sourceId })), candidatesStored: evidenceResult.evidence.length, request: measured, analysis: relation.analysis };
      console.log(JSON.stringify({ stage: selected === quote ? "quote" : "inference", request: measured, analysis: relation.analysis }));
      if (selected === inference) {
        const patchInput = { ...input, analysis: relation.analysis }, patchOptions = patchRequest(patchInput), patchSerialized = prepareGroundingRequest(patchOptions, "openai/gpt-oss-120b");
        await delay(20_000);
        const result = PatchResultSchema.parse(await post("patch", patchInput));
        observations.patch = { request: requestMeasurements({ ...patchOptions, input: JSON.parse(patchSerialized).messages[1].content }, patchSerialized), result: result.patch };
        console.log(JSON.stringify(observations.patch));
      }
    }
  } catch (error) { observations.blocker = error instanceof Error && /^(?:HTTP_|EXTRACTION_SPLIT)/.test(error.message) ? error.message : "VALIDATION_UNAVAILABLE"; console.log(JSON.stringify({ blocker: observations.blocker })); process.exitCode = 1; }
  await mkdir("docs/payload", { recursive: true });
  await writeFile(artifact, JSON.stringify(observations, null, 2) + "\n");
}
main().catch(() => { console.error("Live HTTP validation unavailable; no private details logged."); process.exitCode = 1; });
