import { z } from "zod";
export const HADEETHENC_SOURCE_NAME = "موسوعة الأحاديث النبوية – HadeethEnc";
const text = z.string().min(1).max(30_000);
export const EvidenceExplanationSchema = z.strictObject({
  evidenceId: z.string().min(1).max(200), provider: z.literal("HADEETHENC"), sourceId: z.string().regex(/^\d{1,10}$/),
  exactHadithText: text, exactExplanation: text, title: text,
  attribution: z.string().max(2_000), grade: z.string().max(500), reference: z.string().max(15_000),
  hints: z.array(text).max(100),
  sourceName: z.literal(HADEETHENC_SOURCE_NAME),
  // The API supplies no public record URL. Keep the actual detail request as
  // provenance; do not manufacture a public-page link from its ID.
  sourceUrl: z.null(), apiUrl: z.url().max(1000).refine((value) => {
    const url = new URL(value);
    return url.origin === "https://hadeethenc.com" && !url.username && !url.password && !url.hash && url.pathname === "/api/v1/hadeeths/one/" && url.searchParams.get("language") === "ar" && /^\d{1,10}$/.test(url.searchParams.get("id") ?? "") && [...url.searchParams.keys()].length === 2;
  }),
  matchMethod: z.enum(["EXACT_TEXT", "PHRASE_CONTAINMENT", "STRONG_LEXICAL_MATCH"]),
}).refine((value) => new URL(value.apiUrl).searchParams.get("id") === value.sourceId, { message: "Explanation source ID must match its official API URL" });
export type EvidenceExplanation = z.infer<typeof EvidenceExplanationSchema>;
export const ExplanationStatusSchema = z.enum(["AVAILABLE", "NO_APPROVED_EXPLANATION", "UNAVAILABLE"]);
export type ExplanationResult = { explanation: EvidenceExplanation | null; status: z.infer<typeof ExplanationStatusSchema> };

/** Actual observed Arabic API shapes. Unused fields are deliberately stripped;
 * source strings retained here are never trimmed, normalized or rewritten. */
export const HadeethEncSearchSchema = z.array(z.object({ id: z.string().regex(/^\d{1,10}$/), title: text, hadith_text: text })).max(500);
export const HadeethEncDetailSchema = z.object({
  id: z.string().regex(/^\d{1,10}$/), title: text, hadeeth: text, explanation: text,
  attribution: z.string().max(2_000), grade: z.string().max(500), reference: z.string().max(15_000), hints: z.array(text).max(100),
});
export type HadeethEncDetail = z.infer<typeof HadeethEncDetailSchema>;
