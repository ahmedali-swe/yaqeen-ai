import { loadEnvConfig } from "@next/env";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { withApprovedExplanations } from "../src/evidence/explanations/hadeethenc";
import { analyzeEvidenceRelation } from "../src/ai/evidence-reasoning";
import { generateYaqeenPatch } from "../src/ai/yaqeen-patch";
import { ExtractionError } from "../src/ai/errors";
import { RelationResultSchema, isBoundRelation } from "../src/domain/evidence-reasoning";
import { bukhari71Content, bukhari71Quote, bukhari71Conclusion } from "../tests/fixtures/bukhari-71";

/** One public regression scenario, sequential, stopping at first provider failure.
 * Explicitly separate from source:validate and never a broad live evaluation. */
async function main() {
  loadEnvConfig(process.cwd());
  const evidence = (await localSahihaynProvider.retrieve(bukhari71Quote, new AbortController().signal)).filter(item => item.id === "sahihayn-bukhari-71");
  const source = await withApprovedExplanations({ evidence }, bukhari71Quote.text);
  const observations: Record<string, unknown> = { recordedAt: new Date().toISOString(), mode: "One live Bukhari 71 scenario; no extraction or broad evaluation; fail-fast", evidence, approvedExplanations: source.explanations, explanationStatus: source.explanationStatus };
  const statuses: number[] = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (String(args[0]) === "https://api.groq.com/openai/v1/chat/completions") statuses.push(response.status);
    return response;
  };
  if (!source.explanations?.length) observations.blocker = "NO_APPROVED_EXPLANATION";
  else {
    try {
      let conclusion;
      if (process.argv.includes("--patch-only")) {
        const saved = JSON.parse(await readFile("docs/hadeethenc/live-bukhari-71.json", "utf8"));
        conclusion = RelationResultSchema.parse({ analysis: saved.conclusion });
        if (!isBoundRelation(conclusion.analysis, { claim: bukhari71Conclusion, evidence, originalContent: bukhari71Content })) throw new Error("Unbound saved observation");
        observations.quote = saved.quote; observations.conclusion = conclusion.analysis;
        observations.previousFailures = [...(saved.previousFailures ?? []), ...(saved.blocker ? [{ stage: "patch", code: saved.blocker, statuses: saved.providerStatuses ?? null }] : [])];
        observations.mode = "Single Patch retry; reused actual saved reasoning; no repeated quote/conclusion AI calls";
      } else {
        const quote = await analyzeEvidenceRelation({ claim: bukhari71Quote, evidence, originalContent: bukhari71Content });
        observations.quote = quote.analysis; console.log(JSON.stringify({ claim: "quote", ...quote.analysis }));
        conclusion = await analyzeEvidenceRelation({ claim: bukhari71Conclusion, evidence, originalContent: bukhari71Content });
        observations.conclusion = conclusion.analysis; console.log(JSON.stringify({ claim: "conclusion", ...conclusion.analysis }));
      }
      const correction = await generateYaqeenPatch({ claim: bukhari71Conclusion, evidence, originalContent: bukhari71Content, analysis: conclusion.analysis });
      observations.patch = correction.patch; console.log(JSON.stringify({ patch: correction.patch }));
    } catch (error) {
      observations.blocker = error instanceof ExtractionError ? error.code : "VALIDATION_UNAVAILABLE";
      console.log(JSON.stringify({ blocker: observations.blocker, message: "No unobserved reasoning or Patch result reported." }));
    }
  }
  globalThis.fetch = originalFetch; observations.providerStatuses = statuses;
  await mkdir("docs/hadeethenc", { recursive: true });
  await writeFile("docs/hadeethenc/live-bukhari-71.json", JSON.stringify(observations, null, 2) + "\n", "utf8");
}
main().catch(() => { console.error("Live validation unavailable; no private provider details logged."); process.exitCode = 1; });
