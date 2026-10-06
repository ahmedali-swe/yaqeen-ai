import "server-only";
import { requireAiProviderEnv } from "@/lib/env";
import type { ClaimExtractionProvider } from "./provider";
import { groqProvider } from "./providers/groq";
import { geminiProvider } from "./providers/gemini";

/** Lazy configuration; exactly one provider runs, without automatic fallback. */
export function getClaimExtractionProvider(): ClaimExtractionProvider {
  const { AI_PROVIDER } = requireAiProviderEnv(process.env);
  return AI_PROVIDER === "gemini" ? geminiProvider : groqProvider;
}
