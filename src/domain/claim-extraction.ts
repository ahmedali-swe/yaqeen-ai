import { z } from "zod";
import { MAX_TEXT_LENGTH } from "@/lib/input";

export const ClaimTypeSchema = z.enum([
  "QUOTE", "RELIGIOUS_STATEMENT", "INTERPRETATION", "RULING",
  "HISTORICAL_CLAIM", "TRANSLATION", "GENERAL_CLAIM",
]);
const nullableText = z.string().min(1).max(MAX_TEXT_LENGTH).nullable();
export const ExtractedClaimSchema = z.strictObject({
  id: z.string().min(1).max(100),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  normalizedText: z.string().min(1).max(MAX_TEXT_LENGTH),
  claimType: ClaimTypeSchema,
  subject: nullableText,
  attributedTo: nullableText,
  sourceMentioned: nullableText,
  isVerifiable: z.boolean(),
  verificationReason: z.string().min(1).max(2_000),
  originalStart: z.number().int().min(0).max(MAX_TEXT_LENGTH).nullable(),
  originalEnd: z.number().int().min(0).max(MAX_TEXT_LENGTH).nullable(),
});
export const ClaimExtractionResultSchema = z.strictObject({ claims: z.array(ExtractedClaimSchema).max(100) });
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;
export type ClaimExtractionResult = z.infer<typeof ClaimExtractionResultSchema>;
