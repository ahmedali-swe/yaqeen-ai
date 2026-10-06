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

function normalizeDiscourse(text: string): string {
  return text.normalize("NFC").replace(/[\u064b-\u065f\u0670\u0640]/gu, "").replace(/[أإآ]/gu, "ا");
}

/** Explicit, immediate discourse only. Offsets locate the bridge in the source,
 * including wording omitted by extraction. No theme matching or verdict input. */
export function resolveEvidenceAnchor(claim: ExtractedClaim, claims: ExtractedClaim[], content?: string): EvidenceAnchor | null {
  if (!content || new Set(claims.map((item) => item.id)).size !== claims.length || !["INTERPRETATION", "RELIGIOUS_STATEMENT", "GENERAL_CLAIM", "RULING"].includes(claim.claimType)) return null;
  const selected = claims.find((item) => item.id === claim.id);
  if (!selected || selected.text !== claim.text) return null;
  const start = position(claim, content);
  if (start === null) return null;
  if (claims.some((item) => item.id !== claim.id && ["QUOTE", "RELIGIOUS_STATEMENT"].includes(item.claimType) && position(item, content) === null)) return null;
  const earlier = claims.map((item) => ({ item, start: position(item, content) })).filter((entry): entry is { item: ExtractedClaim; start: number } => entry.start !== null && entry.start + entry.item.text.length <= start && entry.item.id !== claim.id).sort((a, b) => b.start - a.start);
  const previous = earlier[0];
  if (!previous || !["QUOTE", "RELIGIOUS_STATEMENT"].includes(previous.item.claimType)) return null;
  const gap = content.slice(previous.start + previous.item.text.length, start);
  if (gap.length > 100 || /[\r\n]/u.test(gap)) return null;
  // Even the nearest quote is unsafe when another source is in the same local
  // discourse. Ordering alone cannot resolve an ambiguous interpretation.
  if (earlier.slice(1).some(({ item, start: sourceStart }) =>
    ["QUOTE", "RELIGIOUS_STATEMENT"].includes(item.claimType) &&
    start - (sourceStart + item.text.length) <= 240 &&
    !/[\r\n]/u.test(content.slice(sourceStart + item.text.length, start)))) return null;
  // The anaphora may be inside the extracted claim or immediately before it.
  const normalizedGap = normalizeDiscourse(gap);
  const bridge = normalizedGap + normalizeDiscourse(claim.text.slice(0, 140));
  const explicitSource = /هذا الحديث|هذه الاية|هذا النص/u.exec(bridge);
  const discourse = claim.claimType === "INTERPRETATION" || claim.claimType === "RULING" || explicitSource
    ? /(?:^|[\s،,:؛.!؟»”"])(?:و?هذا\s+يعني(?:\s+ان)?|و?يعني(?:\s+ان)?|و?معنى\s+هذا(?:\s+ان)?|اي\s+ان|و?اذن|و?بالتالي|و?بناء\s+على\s+(?:هذا(?:\s+(?:الحديث|النص|الكلام))?|ذلك|الحديث)|و?من\s+هنا|و?لذلك|و?هذا\s+يدل\s+على(?:\s+ان)?|و?نستنتج\s+من\s+ذلك(?:\s+ان)?|و?يفهم\s+من\s+هذا(?:\s+ان)?|و?المقصود\s+ان|و?حسب\s+هذا\s+الكلام|و?هذا\s+معناه(?:\s+ان)?|و?معناته|و?عشان\s+كذا|ثم\s+(?:استنتج|ذكر)\s+ان|ومن\s+هذا\s+نفهم(?:\s+ان)?|فدل\s+ذلك\s+على(?:\s+ان)?)(?=$|[\s،,:؛.!؟])/u.exec(bridge) : null;
  const sourceDependency = /(?:هذا الحديث|هذه الاية|هذا النص)\s+(?:يعني|يدل|تدل|يثبت|تثبت)|(?:يدل|تدل)\s+(?:هذا الحديث|هذه الاية)|(?:ومن ذلك نفهم|وهذا يدل على)/u.exec(bridge);
  const reference = sourceDependency && (!discourse || sourceDependency.index < discourse.index) ? sourceDependency : discourse ?? sourceDependency;
  if (!reference || reference.index > normalizedGap.length + 3) return null;
  const before = bridge.slice(0, reference.index).replace(/[«»“”"،,:؛.!؟\s]/gu, " ").trim();
  if (before && !/^(?:(?:ثم|و|ذكر|قال|كتب|اضاف|ان|الكاتب|الكاتبة|المؤلف|المؤلفة|وذكر|وقال|واضاف)\s*)+$/u.test(before)) return null;
  // Nothing substantive may intervene between the connector and the selected
  // proposition. A connector elsewhere in the paragraph is not an anchor.
  if (reference === discourse) {
    const after = bridge.slice(reference.index + reference[0].length, normalizedGap.length).replace(/[«»“”"،,:؛.!؟\s]/gu, " ").trim();
    if (after && !/^(?:ان\s+)?(?:(?:هذا الحديث|هذه الاية|هذا النص)\s+(?:يعني|يدل|تدل|يثبت|تثبت)(?:\s+على)?(?:\s+ان)?)?$/u.test(after)) return null;
  }
  const sourceReference = explicitSource?.[0] ?? reference[0];
  const sourceHint = previous.item.sourceMentioned ?? "";
  const sourceType = sourceReference.includes("حديث") ? "HADITH" : sourceReference.includes("اية") ? "QURAN"
    : /حديث|البخاري|مسلم/u.test(sourceHint) ? "HADITH" : /القرآن|سورة|آية/u.test(sourceHint) ? "QURAN" : "TEXT";
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
