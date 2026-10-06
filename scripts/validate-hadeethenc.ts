import { mkdir, writeFile } from "node:fs/promises";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { hadeethEncResolver } from "../src/evidence/explanations/hadeethenc";
import type { ExtractedClaim } from "../src/domain/claim-extraction";

async function main() {
  const observations = [];
  for (const [referenceId, text] of [["sahihayn-bukhari-1", "إنما الأعمال بالنيات"], ["sahihayn-bukhari-71", "من يرد الله به خيرًا يفقهه في الدين"], ["sahihayn-muslim-223", "الطهور شطر الإيمان"]]) {
    const claim: ExtractedClaim = { id: "source-validation", text, normalizedText: text, claimType: "QUOTE", subject: null, attributedTo: null, sourceMentioned: null, isVerifiable: true, verificationReason: "مقارنة بالمصدر الرسمي.", originalStart: null, originalEnd: null };
    const records = await localSahihaynProvider.retrieve(claim, new AbortController().signal);
    const evidence = records.find((record) => record.id === referenceId);
    if (!evidence) throw new Error("Missing local reference");
    const before = JSON.stringify(evidence), result = await hadeethEncResolver.resolve(evidence, text);
    if (JSON.stringify(evidence) !== before) throw new Error("Source mutation");
    const observation = { evidenceId: evidence.id, reference: evidence.reference, status: result.status, sourceId: result.explanation?.sourceId ?? null, explanationAvailable: !!result.explanation?.exactExplanation, referenceAvailable: !!result.explanation?.reference, gradeAvailable: !!result.explanation?.grade, matchMethod: result.explanation?.matchMethod ?? null, explanation: result.explanation };
    observations.push(observation); console.log(JSON.stringify({ ...observation, explanation: undefined }));
  }
  await mkdir("docs/hadeethenc", { recursive: true });
  await writeFile("docs/hadeethenc/live-source-validation.json", JSON.stringify({ recordedAt: new Date().toISOString(), method: "Real documented official search and detail API; local Sahihayn evidence; deterministic matcher; no Groq calls.", observations }, null, 2) + "\n", "utf8");
}
main().catch(() => { console.error("Official source validation failed; no explanation fabricated."); process.exitCode = 1; });
