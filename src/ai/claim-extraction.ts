import "server-only";
import { ClaimExtractionResultSchema, type ClaimExtractionResult } from "@/domain/claim-extraction";
import { validateText } from "@/lib/input";
import { ExtractionError } from "./errors";
import type { ClaimExtractionProvider } from "./provider";
import { getClaimExtractionProvider } from "./configured-provider";
import { groqProvider } from "./providers/groq";
import { requireGroqEnv } from "@/lib/env";
import { aiRequestKey, sharedAiResults, type AiExecutionOptions } from "./result-cache";

export const EXTRACTION_TIMEOUT_MS = 30_000;
const identity = (text: string) => text.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();

export function validateExtraction(raw: unknown, input: string): ClaimExtractionResult {
  const parsed = ClaimExtractionResultSchema.safeParse(raw);
  if (!parsed.success) throw new ExtractionError("INVALID_AI_RESPONSE");
  const seen = new Set<string>();
  const claims: ClaimExtractionResult["claims"] = [];
  for (const claim of parsed.data.claims) {
    if (!claim.isVerifiable) continue;
    if (!claim.text.trim() || !claim.normalizedText.trim() || !claim.verificationReason.trim()) throw new ExtractionError("INVALID_AI_RESPONSE");
    const start = input.indexOf(claim.text);
    if (start === -1) throw new ExtractionError("INVALID_AI_RESPONSE");
    // Conservative de-duplication: don't merge different wording/attributions.
    const key = JSON.stringify([identity(claim.text), claim.claimType, claim.attributedTo && identity(claim.attributedTo), claim.sourceMentioned && identity(claim.sourceMentioned)]);
    if (seen.has(key)) continue;
    seen.add(key);
    const validSpan = claim.originalStart !== null && claim.originalEnd !== null && claim.originalEnd > claim.originalStart && input.slice(claim.originalStart, claim.originalEnd) === claim.text;
    const uniqueOccurrence = input.indexOf(claim.text, start + 1) === -1;
    claims.push({
      ...claim,
      id: `claim-${claims.length + 1}`,
      originalStart: validSpan ? claim.originalStart : uniqueOccurrence ? start : null,
      originalEnd: validSpan ? claim.originalEnd : uniqueOccurrence ? start + claim.text.length : null,
    });
  }
  return { claims };
}

export async function extractClaims(text: string, provider?: ClaimExtractionProvider, parentSignal?: AbortSignal, execution?: AiExecutionOptions): Promise<ClaimExtractionResult> {
  if (validateText(text)) throw new Error("Invalid extraction input");
  const selected = provider ?? getClaimExtractionProvider();
  if (selected !== groqProvider) return extractOnce(text, selected, parentSignal);
  const { GROQ_TEXT_MODEL } = requireGroqEnv(process.env);
  return sharedAiResults.run(aiRequestKey("claim-extraction", GROQ_TEXT_MODEL, { text }), (signal) => extractOnce(text, selected, signal), parentSignal, execution);
}

async function extractOnce(text: string, provider: ClaimExtractionProvider, parentSignal?: AbortSignal): Promise<ClaimExtractionResult> {
  const invalid = validateText(text);
  if (invalid) throw new Error("Invalid extraction input");
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ExtractionError("AI_TIMEOUT")); }, EXTRACTION_TIMEOUT_MS);
    });
    const raw = await Promise.race([provider.extract(text, controller.signal), deadline]);
    return validateExtraction(raw, text);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(controller.signal.aborted ? "AI_TIMEOUT" : "AI_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  }
}
