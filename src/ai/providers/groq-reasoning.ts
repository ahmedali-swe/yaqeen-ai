import "server-only";
import { z } from "zod";
import { RelationResultSchema, explicitContextEvidenceId, type ReadonlyRelationInput } from "@/domain/evidence-reasoning";
import type { EvidenceReasoningProvider } from "../evidence-reasoning";
import { EVIDENCE_REASONING_INSTRUCTIONS } from "../evidence-reasoning-prompt";
import { generateGroqStructuredOutput } from "./groq";
import { ExtractionError } from "../errors";
import { compactClaim, groundingPayload } from "../grounding-payload";

/** Separate a generic author's reporting frame from the quoted proposition.
 * Keep the full claim in the payload; never remove a named religious attribution,
 * a qualification, multiple quotations, or a frame absent from original content.
 */
function comparisonClaim(input: ReadonlyRelationInput) {
  if (input.claim.claimType !== "QUOTE" || !input.originalContent?.includes(input.claim.text)) return input.claim;
  const genericAttribution = /^(?:الكاتب|الكاتبة|صاحب النص|المؤلف|المؤلفة|(?:the\s+)?(?:author|writer))$/i;
  if (input.claim.attributedTo !== null && !genericAttribution.test(input.claim.attributedTo.trim())) return input.claim;
  const match = /^(?:قال|كتب|ذكر|نقل|يقول)\s+(?:الكاتب|الكاتبة|صاحب النص|المؤلف|المؤلفة)\s*[:：]?\s*[«“"]([^»”"]+)[»”"]\s*[.،]?$/.exec(input.claim.text)
    ?? /^(?:the\s+)?(?:author|writer)\s+(?:said|wrote|quoted)\s*:?\s*[“"]([^”"]+)[”"]\s*[.]?$/i.exec(input.claim.text);
  let quotedText = match?.[1];
  if (!quotedText) {
    // Extraction can return only the quoted proposition while recording its
    // reporting author. Confirm that exact proposition in a nearby generic frame;
    // never interpret a named religious speaker as merely a reporting author.
    const standalone = /^[«“"]([^»”"]+)[»”"]\s*[.،]?$/.exec(input.claim.text)?.[1] ?? input.claim.text;
    const frames = [
      ...input.originalContent.matchAll(/(?:^|[\s.!؟])(?:قال|كتب|ذكر|نقل|يقول)\s+(?:الكاتب|الكاتبة|صاحب النص|المؤلف|المؤلفة)\s*[:：]?\s*[«“"]([^»”"]+)[»”"]/gu),
      ...input.originalContent.matchAll(/(?:^|[\s.!?])(?:the\s+)?(?:author|writer)\s+(?:said|wrote|quoted)\s*:?\s*[“"]([^”"]+)[”"]/giu),
    ];
    quotedText = frames.find((frame) => frame[1] === standalone)?.[1];
  }
  if (!quotedText) return input.claim;
  return { ...input.claim, text: quotedText, normalizedText: quotedText, attributedTo: null, originalStart: null, originalEnd: null };
}

export function reasoningRequest(input: ReadonlyRelationInput) {
    const { $schema: dialect, ...schema } = z.toJSONSchema(RelationResultSchema);
    void dialect;
    // Constrain evidence selection at generation as well as at validation time.
    const analysisSchema = schema.properties?.analysis;
    if (!analysisSchema || typeof analysisSchema === "boolean" || !analysisSchema.properties) throw new ExtractionError("INVALID_AI_RESPONSE");
    // Groq's strict validator rejected a matching ID in an anyOf(enum, null)
    // schema during the live check. A nullable enum expresses the same binding
    // directly and avoids that branch-validation failure.
    const payload = groundingPayload(input);
    const contextEvidenceId = payload.contextualAnchor?.evidenceId ?? explicitContextEvidenceId(input);
    analysisSchema.properties.strongestEvidenceId = contextEvidenceId
      ? { type: "string", enum: [contextEvidenceId] }
      : { type: ["string", "null"], enum: [payload.evidence[0].id, null] };
    // Relevance is retrieval ordering, not a reason to accept an inference.
    const claim = comparisonClaim(input);
    return { instructions: EVIDENCE_REASONING_INSTRUCTIONS, input: JSON.stringify({ ...payload, claim: compactClaim(claim), ...(claim !== input.claim ? { originalClaimText: input.claim.text } : {}), reportingFrameConfirmed: claim !== input.claim, contextEvidenceId }), schemaName: "claim_evidence_relation", schema };
}
export const groqReasoningProvider: EvidenceReasoningProvider = {
  analyze(input, signal) { return generateGroqStructuredOutput(reasoningRequest(input), signal); },
};
