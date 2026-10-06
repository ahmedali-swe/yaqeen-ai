import "server-only";
import { z } from "zod";
import { ClaimExtractionResultSchema } from "@/domain/claim-extraction";
import { requireGroqEnv } from "@/lib/env";
import { readBoundedBody } from "@/lib/read-bounded-body";
import { ExtractionError } from "../errors";
import { CLAIM_EXTRACTION_INSTRUCTIONS } from "../prompts";
import type { ClaimExtractionProvider } from "../provider";
import { requestGroqWithRetry } from "./groq-retry";
import { prepareGroundingRequest, requestMeasurements, serializeGroqRequest, type StructuredRequest } from "../groq-request";

const { $schema: dialect, ...responseSchema } = z.toJSONSchema(ClaimExtractionResultSchema);
void dialect;
const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.literal("stop"),
    message: z.object({ content: z.string().min(1).max(200_000), refusal: z.string().nullable().optional() }),
  })).length(1),
});

/** Shared strict-output transport for extraction and evidence reasoning. */
export async function generateGroqStructuredOutput(options: StructuredRequest, signal: AbortSignal): Promise<unknown> {
    const { GROQ_API_KEY, GROQ_TEXT_MODEL } = requireGroqEnv(process.env);
    const grounded = ["claim_evidence_relation", "yaqeen_patch"].includes(options.schemaName);
    const body = grounded ? prepareGroundingRequest(options, GROQ_TEXT_MODEL) : serializeGroqRequest(options, GROQ_TEXT_MODEL);
    if (grounded && process.env.NODE_ENV === "development") {
      const actualInput = JSON.parse(body).messages[1].content;
      console.info("[Yaqeen: grounding request sizes]", requestMeasurements({ ...options, input: actualInput }, body));
    }
    const deadline = AbortSignal.timeout(30_000);
    const requestSignal = AbortSignal.any([signal, deadline]);
    const response = await requestGroqWithRetry(() => fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body,
        signal: requestSignal,
        cache: "no-store",
        redirect: "error",
      }), requestSignal);
    try {
      const body = await readBoundedBody(response.body, 512 * 1024);
      if (body === null) throw new ExtractionError("INVALID_AI_RESPONSE");
      const completion = completionSchema.safeParse(JSON.parse(body));
      if (!completion.success || completion.data.choices[0].message.refusal) throw new ExtractionError("INVALID_AI_RESPONSE");
      // Decode only strict schema-constrained output, never fenced/free-form JSON.
      return JSON.parse(completion.data.choices[0].message.content) as unknown;
    } catch (error) {
      if (requestSignal.aborted) throw new ExtractionError("AI_TIMEOUT");
      if (error instanceof ExtractionError) throw error;
      throw new ExtractionError("INVALID_AI_RESPONSE");
    }
}

export const groqProvider: ClaimExtractionProvider = {
  extract(text, signal) {
    return generateGroqStructuredOutput({ instructions: CLAIM_EXTRACTION_INSTRUCTIONS, input: text, schemaName: "claim_extraction_result", schema: responseSchema }, signal);
  },
};
