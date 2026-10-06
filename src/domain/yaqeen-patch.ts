import { z } from "zod";
import { MutationType } from "./analysis";
import { RelationAnalysisSchema, RelationInputSchema, isBoundRelation } from "./evidence-reasoning";
import { MAX_TEXT_LENGTH } from "@/lib/input";
import { requiresPersonalSpecialist } from "./specialist-boundary";
import { normalizeForSearch } from "@/evidence/matching";

const explanation = z.string().trim().min(1).max(1_500);
export const PatchSchema = z.strictObject({
  action: z.enum(["PATCH", "NO_SAFE_PATCH", "REFER_SPECIALIST"]),
  originalText: z.string().min(1).max(MAX_TEXT_LENGTH),
  proposedText: z.string().min(1).max(MAX_TEXT_LENGTH).nullable(),
  changes: z.array(z.strictObject({
    originalSegment: z.string().min(1).max(MAX_TEXT_LENGTH),
    replacementSegment: z.string().min(1).max(MAX_TEXT_LENGTH).nullable(),
    mutationType: z.enum(MutationType),
    reason: explanation,
  })).max(5),
  preservedIntent: explanation,
  evidenceIds: z.array(z.string().min(1).max(200)).max(8),
  explanation,
});
export const PatchResultSchema = z.strictObject({ patch: PatchSchema });
export const PatchInputSchema = RelationInputSchema.safeExtend({ analysis: RelationAnalysisSchema })
  .superRefine((input, context) => {
    if (!isBoundRelation(input.analysis, input)) context.addIssue({ code: "custom", message: "Analysis must be bound to the supplied claim and evidence", path: ["analysis"] });
  });
export type Patch = z.infer<typeof PatchSchema>;
export type PatchInput = z.infer<typeof PatchInputSchema>;
export type PatchResult = z.infer<typeof PatchResultSchema>;

/** An auditable edit script: ambiguous, overlapping and unreported edits fail closed. */
export function applyPatchChanges(original: string, changes: Patch["changes"]): string | null {
  const edits = changes.map((change) => ({ ...change, start: original.indexOf(change.originalSegment) }));
  if (edits.some((edit) => edit.start < 0 || original.indexOf(edit.originalSegment, edit.start + 1) !== -1 || edit.originalSegment === edit.replacementSegment)) return null;
  edits.sort((a, b) => a.start - b.start);
  if (edits.some((edit, index) => index > 0 && edit.start < edits[index - 1].start + edits[index - 1].originalSegment.length)) return null;
  let result = "", cursor = 0;
  for (const edit of edits) {
    result += original.slice(cursor, edit.start) + (edit.replacementSegment ?? "");
    cursor = edit.start + edit.originalSegment.length;
  }
  return result + original.slice(cursor);
}

/** Remove unchanged prefix/suffix from a valid edit, retaining an unambiguous anchor. */
export function minimizePatchEdits(patch: Patch, input: PatchInput): Patch {
  if (patch.action !== "PATCH") return patch;
  const changes = patch.changes.map((change) => {
    if (change.replacementSegment === null) return change;
    const original = change.originalSegment, replacement = change.replacementSegment;
    let prefix = 0, suffix = 0;
    while (prefix < original.length - 1 && prefix < replacement.length - 1 && original[prefix] === replacement[prefix]) prefix++;
    while (suffix < original.length - prefix - 1 && suffix < replacement.length - prefix - 1 && original[original.length - suffix - 1] === replacement[replacement.length - suffix - 1]) suffix++;
    // Keep complete words readable in the before/after change list.
    while (prefix > 0 && /[\p{L}\p{M}\p{N}]/u.test(original[prefix - 1])) prefix--;
    while (suffix > 0 && /[\p{L}\p{M}\p{N}]/u.test(original[original.length - suffix])) suffix--;
    return { ...change, originalSegment: original.slice(prefix, original.length - suffix), replacementSegment: replacement.slice(prefix, replacement.length - suffix) };
  });
  const minimized = { ...patch, changes };
  return isBoundPatch(minimized, input) ? minimized : patch;
}

function protectedQuotes(text: string): string[] {
  return [...text.matchAll(/[«“"]([^»”"]+)[»”"]/gu)].map((match) => match[1]);
}

/** Bare QUOTE claims are religious quotations too, not free rewriting material. */
export function isVerbatimQuotePatch(patch: Patch, input: PatchInput): boolean {
  if (patch.action !== "PATCH" || input.claim.claimType !== "QUOTE" || protectedQuotes(input.claim.text).length) return true;
  return patch.proposedText !== null && input.evidence.some((item) => patch.evidenceIds.includes(item.id) && item.exactText.includes(patch.proposedText!));
}

/** Unsupported inference is a lack of entailment, never proof of its opposite.
 * Accept a scoped evidential qualification or an exact supplied meaning only. */
export function isEvidenceBoundedInferencePatch(patch: Patch, input: PatchInput): boolean {
  if (patch.action !== "PATCH" || input.analysis.relationType !== "UNSUPPORTED_INFERENCE" || !input.approvedExplanations?.length) return true;
  const proposed = normalizeForSearch(patch.proposedText ?? "");
  if (/^(?:لا يكفي هذا الحديث للاستدلال علي|لا يدل هذا الحديث علي|لا يثبت هذا الحديث ان|لا يمكن الاستدلال بهذا الحديث علي)\s/u.test(proposed)) return true;
  const meaning = proposed.replace(/^هذا الحديث يعني ان\s/u, "");
  return meaning.length >= 15 && [...input.evidence.map((item) => item.exactText), ...input.approvedExplanations.map((item) => item.exactExplanation)].some((text) => ` ${normalizeForSearch(text)} `.includes(` ${meaning} `));
}

/** Structural safety checks, not a substitute for specialist semantic review. */
export function isBoundPatch(patch: Patch, input: PatchInput): boolean {
  if (patch.originalText !== input.claim.text || new Set(patch.evidenceIds).size !== patch.evidenceIds.length) return false;
  if (patch.evidenceIds.some((id) => !input.evidence.some((item) => item.id === id))) return false;
  if ([patch.explanation, patch.preservedIntent, ...patch.changes.map((change) => change.reason)].some((value) => !/\p{Script=Arabic}/u.test(value))) return false;
  if (requiresPersonalSpecialist(input.claim) || input.analysis.requiresSpecialist || input.analysis.verificationStatus === "REQUIRES_SPECIALIST") return patch.action === "REFER_SPECIALIST" && patch.proposedText === null && !patch.changes.length;
  if (patch.action === "REFER_SPECIALIST") return false;
  if (patch.action !== "PATCH") return patch.proposedText === null && !patch.changes.length;
  if (!input.evidence.length || input.analysis.strongestEvidenceId === null || input.analysis.verificationStatus === "SUPPORTED" || input.analysis.relationType === "NONE") return false;
  if (!patch.evidenceIds.includes(input.analysis.strongestEvidenceId) || !patch.changes.length || !patch.proposedText?.trim() || patch.proposedText === input.claim.text) return false;
  if (applyPatchChanges(input.claim.text, patch.changes) !== patch.proposedText) return false;
  if (patch.changes.some((change) => change.mutationType !== input.analysis.relationType)) return false;
  const cited = input.evidence.filter((item) => patch.evidenceIds.includes(item.id));
  // Every altered/new marked religious quotation must be exact supplied wording.
  const before = protectedQuotes(input.claim.text), after = protectedQuotes(patch.proposedText);
  if (after.some((quote) => !before.includes(quote) && !cited.some((item) => item.exactText.includes(quote)))) return false;
  for (const quote of before) {
    if (!after.includes(quote) && !patch.changes.some((change) => change.originalSegment.includes(quote) && change.replacementSegment !== null && cited.some((item) => item.exactText.includes(change.replacementSegment!)))) return false;
  }
  return true;
}
