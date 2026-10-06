import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { ClaimExtractionResultSchema } from "@/domain/claim-extraction";
import { requireGeminiEnv } from "@/lib/env";
import { ExtractionError } from "../errors";
import { logGeminiFailure } from "../diagnostics";
import { CLAIM_EXTRACTION_INSTRUCTIONS } from "../prompts";
import type { ClaimExtractionProvider } from "../provider";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";
// Gemini's supported JSON Schema subset omits string length keywords.
// Keep those stricter checks in the local Zod validator.
const responseJsonSchema: unknown = JSON.parse(JSON.stringify(z.toJSONSchema(ClaimExtractionResultSchema), (key, value) =>
  ["$schema", "minLength", "maxLength"].includes(key) ? undefined : value));

export const geminiProvider: ClaimExtractionProvider = {
  async extract(text, signal) {
    const { GEMINI_API_KEY } = requireGeminiEnv(process.env);
    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    let response;
    try {
      response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
          systemInstruction: CLAIM_EXTRACTION_INSTRUCTIONS,
          responseMimeType: "application/json",
          responseJsonSchema,
          maxOutputTokens: 16_384,
          abortSignal: signal,
          httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } },
        },
      });
    } catch (error) {
      logGeminiFailure(error);
      throw new ExtractionError(signal.aborted ? "AI_TIMEOUT" : "AI_UNAVAILABLE");
    }
    if (response.candidates?.[0]?.finishReason !== "STOP" || !response.text || response.text.length > 200_000) {
      throw new ExtractionError("INVALID_AI_RESPONSE");
    }
    try {
      // Decode only schema-constrained output. No free-form/fenced JSON fallback.
      return JSON.parse(response.text) as unknown;
    } catch {
      throw new ExtractionError("INVALID_AI_RESPONSE");
    }
  },
};
