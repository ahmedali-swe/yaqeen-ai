import { z } from "zod";
import type { ExtractedClaim } from "@/domain/claim-extraction";
import { SAHIHAYN_REFERENCE_ID_PATTERN } from "./sahihayn-schema";
import { EvidenceExplanationSchema, ExplanationStatusSchema } from "./explanations/types";

const canonicalUrl = z.url().max(1000).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    ["quranpedia.net", "dorar.net", "sunnah.com"].includes(url.hostname);
});

function matchesSourceUrl(value: string, sourceType: "QURAN" | "HADITH" | "TAFSIR"): boolean {
  const url = new URL(value);
  if (sourceType !== "HADITH") return url.hostname === "quranpedia.net";
  return url.hostname === "dorar.net" || (url.hostname === "sunnah.com" && !url.search && !url.hash && new RegExp(`^/(?:bukhari|muslim):${SAHIHAYN_REFERENCE_ID_PATTERN}$`).test(url.pathname));
}

export const EvidenceCandidateSchema = z.strictObject({
  id: z.string().min(1).max(200),
  sourceType: z.enum(["QURAN", "HADITH", "TAFSIR"]),
  title: z.string().min(1).max(1000),
  exactText: z.string().min(1).max(100_000),
  reference: z.string().min(1).max(1000).nullable(),
  canonicalUrl: canonicalUrl.nullable(),
  sourceName: z.string().min(1).max(1000),
  // Lexical relevance only. Never a probability of truth or a claim verdict.
  relevanceScore: z.number().min(0).max(1),
  metadata: z.record(z.string().max(100), z.union([z.string().max(100_000), z.number(), z.boolean(), z.null()])),
}).refine((item) => item.canonicalUrl === null ? item.sourceType === "HADITH" : matchesSourceUrl(item.canonicalUrl, item.sourceType));

/** A returned search link is distinct from an individual canonical citation. */
export function evidenceSourceUrl(item: EvidenceCandidate): string | null {
  if (item.canonicalUrl) return item.canonicalUrl;
  const value = item.metadata.sourceUrl;
  if (typeof value !== "string" || !canonicalUrl.safeParse(value).success) return null;
  return matchesSourceUrl(value, item.sourceType) ? value : null;
}

export const RetrievalSummarySchema = z.strictObject({
  hadithCorpus: z.literal("SAHIHAYN"),
  hadith: z.enum(["LOCAL_PRIMARY", "DORAR_CROSSCHECK", "NO_LOCAL_MATCH", "NOT_REQUESTED"]),
  dorar: z.enum(["NOT_REQUESTED", "DISABLED", "AVAILABLE", "UNAVAILABLE"]),
  quranpedia: z.enum(["NOT_REQUESTED", "AVAILABLE", "UNAVAILABLE"]),
});
export const EvidenceResolutionSchema = z.strictObject({
  evidenceOrigin: z.enum(["DIRECT", "CONTEXTUAL_ANCHOR"]), evidenceAnchorClaimId: z.string().min(1).max(100).nullable(),
}).refine((value) => value.evidenceOrigin === "CONTEXTUAL_ANCHOR" ? value.evidenceAnchorClaimId !== null : value.evidenceAnchorClaimId === null);
export const EvidenceResultSchema = z.strictObject({ evidence: z.array(EvidenceCandidateSchema).max(8), retrieval: RetrievalSummarySchema.optional(), resolution: EvidenceResolutionSchema.optional(), explanations: z.array(EvidenceExplanationSchema).max(8).optional(), explanationStatus: ExplanationStatusSchema.optional() }).refine((result) =>
  new Set(result.explanations?.map((item) => item.evidenceId)).size === (result.explanations?.length ?? 0) && (result.explanations ?? []).every((explanation) => result.evidence.some((item) => item.id === explanation.evidenceId && item.sourceType === "HADITH")));
export type EvidenceResolution = z.infer<typeof EvidenceResolutionSchema>;
export type RetrievalSummary = z.infer<typeof RetrievalSummarySchema>;
export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>;
export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;
export interface EvidenceProvider {
  retrieve(claim: ExtractedClaim, signal: AbortSignal): Promise<EvidenceCandidate[]>;
}

export class EvidenceRetrievalError extends Error {
  constructor(public readonly code: "EVIDENCE_UNAVAILABLE" | "INVALID_EVIDENCE_RESPONSE" | "EVIDENCE_TIMEOUT") {
    super(code);
    this.name = "EvidenceRetrievalError";
  }
}
