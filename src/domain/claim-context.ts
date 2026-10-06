import { z } from "zod";
import { ExtractedClaimSchema, type ExtractedClaim } from "./claim-extraction";
import { MAX_TEXT_LENGTH } from "@/lib/input";

export type EvidenceAnchor = { evidenceAnchorClaimId: string; sourceType: "HADITH" | "QURAN" | "TEXT" };
export const ClaimContextSchema = z.strictObject({
  claims: z.array(ExtractedClaimSchema).min(1).max(100),
  originalContent: z.string().min(1).max(MAX_TEXT_LENGTH),
  evidenceAnchorClaimId: z.string().min(1).max(100).nullable().optional(),
}).superRefine((value, context) => {
  if (new Set(value.claims.map((claim) => claim.id)).size !== value.claims.length) context.addIssue({ code: "custom", message: "Claim IDs must be unique" });
  if (value.claims.some((claim) => !value.originalContent.includes(claim.text))) context.addIssue({ code: "custom", message: "Claims must occur in the original content" });
});
export type ClaimContext = z.infer<typeof ClaimContextSchema>;

function position(claim: ExtractedClaim, content: string): number | null {
  if (claim.originalStart !== null || claim.originalEnd !== null) {
    return claim.originalStart !== null && claim.originalEnd !== null && claim.originalEnd > claim.originalStart && content.slice(claim.originalStart, claim.originalEnd) === claim.text ? claim.originalStart : null;
  }
  const start = content.indexOf(claim.text);
  return start >= 0 && content.indexOf(claim.text, start + 1) === -1 ? start : null;
}

/** Explicit, immediate discourse only. Offsets locate the bridge in the source,
 * including wording omitted by extraction. No theme matching or verdict input. */
export function resolveEvidenceAnchor(claim: ExtractedClaim, claims: ExtractedClaim[], content?: string): EvidenceAnchor | null {
  if (!content || new Set(claims.map((item) => item.id)).size !== claims.length || !["INTERPRETATION", "RELIGIOUS_STATEMENT", "GENERAL_CLAIM", "RULING"].includes(claim.claimType)) return null;
  const selected = claims.find((item) => item.id === claim.id);
  if (!selected || selected.text !== claim.text) return null;
  const start = position(claim, content);
  if (start === null) return null;
  const earlier = claims.map((item) => ({ item, start: position(item, content) })).filter((entry): entry is { item: ExtractedClaim; start: number } => entry.start !== null && entry.start + entry.item.text.length <= start && entry.item.id !== claim.id).sort((a, b) => b.start - a.start);
  const previous = earlier[0];
  if (!previous || !["QUOTE", "RELIGIOUS_STATEMENT"].includes(previous.item.claimType)) return null;
  const gap = content.slice(previous.start + previous.item.text.length, start);
  if (gap.length > 100 || /[\r\n]/u.test(gap)) return null;
  // The anaphora may be inside the extracted claim or immediately before it.
  const bridge = gap + claim.text.slice(0, 140);
  const explicitSource = /هذا الحديث|هذه الآية|هذا النص/u.exec(bridge);
  const discourse = claim.claimType === "INTERPRETATION" || claim.claimType === "RULING" || explicitSource
    ? /(?:ثم\s+(?:استنتج|ذكر)\s+أن|و?بناءً?\s+على\s+ذلك|و?لذلك|ومن\s+هذا\s+نفهم|وهذا\s+يدل\s+على|فدل\s+ذلك\s+على)/u.exec(bridge) : null;
  const reference = discourse ?? /(?:هذا الحديث|هذه الآية|هذا النص)\s+(?:يعني|يدل|تدل|يثبت|تثبت)|(?:يدل|تدل)\s+(?:هذا الحديث|هذه الآية)|(?:ومن ذلك نفهم|وهذا يدل على)/u.exec(bridge);
  if (!reference || reference.index > gap.length + 3) return null;
  const before = bridge.slice(0, reference.index).replace(/[«»“”"،,:؛.!؟\s]/gu, " ").trim();
  if (before && !/^(?:(?:ثم|و|ذكر|قال|كتب|أضاف|أن|إن|الكاتب|الكاتبة|المؤلف|المؤلفة|وذكر|وقال|وأضاف)\s*)+$/u.test(before)) return null;
  // Nothing substantive may intervene between the connector and the selected
  // proposition. A connector elsewhere in the paragraph is not an anchor.
  if (discourse) {
    const after = bridge.slice(reference.index + reference[0].length, gap.length).replace(/[«»“”"،,:؛.!؟\s]/gu, " ").trim();
    if (after && !/^(?:أن\s+)?(?:(?:هذا الحديث|هذه الآية|هذا النص)\s+(?:يعني|يدل|تدل|يثبت|تثبت)(?:\s+على)?(?:\s+أن)?)?$/u.test(after)) return null;
  }
  const sourceReference = explicitSource?.[0] ?? reference[0];
  const sourceType = sourceReference.includes("حديث") ? "HADITH" : sourceReference.includes("آية") ? "QURAN" : "TEXT";
  const sourceHint = previous.item.sourceMentioned ?? "";
  if ((sourceType === "HADITH" && /القرآن|سورة|آية/u.test(sourceHint)) || (sourceType === "QURAN" && /حديث|البخاري|مسلم/u.test(sourceHint))) return null;
  return { evidenceAnchorClaimId: previous.item.id, sourceType };
}

export const EvidenceRequestSchema = z.strictObject({ claim: ExtractedClaimSchema, context: ClaimContextSchema.optional() }).superRefine((input, context) => {
  if (!input.context) return;
  const selected = input.context.claims.find((claim) => claim.id === input.claim.id);
  if (!selected || JSON.stringify(selected) !== JSON.stringify(input.claim)) context.addIssue({ code: "custom", message: "Selected claim must match its context" });
  const anchor = resolveEvidenceAnchor(input.claim, input.context.claims, input.context.originalContent);
  if (input.context.evidenceAnchorClaimId !== undefined && input.context.evidenceAnchorClaimId !== (anchor?.evidenceAnchorClaimId ?? null)) context.addIssue({ code: "custom", message: "Anchor must match an explicit preceding claim reference" });
});
