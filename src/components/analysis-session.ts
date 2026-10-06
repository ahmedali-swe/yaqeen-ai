import { z } from "zod";
import { ClaimExtractionResultSchema } from "@/domain/claim-extraction";
import { ClaimContextSchema, resolveEvidenceAnchor } from "@/domain/claim-context";
import { RelationAnalysisSchema, RelationInputSchema, isBoundRelation } from "@/domain/evidence-reasoning";
import { PatchSchema, isBoundPatch, isVerbatimQuotePatch } from "@/domain/yaqeen-patch";
import { EvidenceResultSchema } from "@/evidence/types";
import { MAX_TEXT_LENGTH } from "@/lib/input";

export const ANALYSIS_SESSION_KEY = "yaqeen:analysis-session:v1";
const MAX_SESSION_LENGTH = 2_500_000;
const StageSchema = z.enum(["claims", "evidence", "relation", "meaning", "patch"]);
export const AnalysisSessionSchema = z.strictObject({
  version: z.literal(1), id: z.string().min(1).max(100),
  result: ClaimExtractionResultSchema,
  originalContent: z.string().min(1).max(MAX_TEXT_LENGTH).optional(),
  report: z.strictObject({
    selectedClaimId: z.string().max(100),
    states: z.record(z.string().max(100), z.strictObject({ evidenceResult: EvidenceResultSchema.optional(), analysis: RelationAnalysisSchema.optional(), patch: PatchSchema.optional() })),
    activeStages: z.record(z.string().max(100), StageSchema),
  }),
}).superRefine((session, context) => {
  const claims = session.result.claims, ids = new Set(claims.map((claim) => claim.id));
  const invalid = () => context.addIssue({ code: "custom", message: "Inconsistent analysis session" });
  if (ids.size !== claims.length || (session.report.selectedClaimId && !ids.has(session.report.selectedClaimId)) || [...Object.keys(session.report.states), ...Object.keys(session.report.activeStages)].some((id) => !ids.has(id))) return invalid();
  if (claims.length && session.originalContent && !ClaimContextSchema.safeParse({ claims, originalContent: session.originalContent }).success) return invalid();
  for (const [id, state] of Object.entries(session.report.states)) {
    const claim = claims.find((item) => item.id === id)!;
    const input = { claim, evidence: state.evidenceResult?.evidence ?? [], originalContent: session.originalContent, approvedExplanations: state.evidenceResult?.explanations };
    if (input.approvedExplanations?.length && !RelationInputSchema.safeParse(input).success) return invalid();
    const resolution = state.evidenceResult?.resolution;
    if (resolution?.evidenceOrigin === "CONTEXTUAL_ANCHOR") {
      const anchor = resolveEvidenceAnchor(claim, claims, session.originalContent);
      if (!anchor || anchor.evidenceAnchorClaimId !== resolution.evidenceAnchorClaimId || input.evidence.some((item) => anchor.sourceType === "HADITH" ? item.sourceType !== "HADITH" : anchor.sourceType === "QURAN" && item.sourceType === "HADITH")) return invalid();
    }
    if (state.analysis && (!state.evidenceResult || !isBoundRelation(state.analysis, input))) return invalid();
    if (state.patch && (!state.analysis || !isBoundPatch(state.patch, { ...input, analysis: state.analysis }) || !isVerbatimQuotePatch(state.patch, { ...input, analysis: state.analysis }))) return invalid();
  }
});
export type AnalysisSession = z.infer<typeof AnalysisSessionSchema>;

/** Browser-session persistence only; blocked/quota-limited storage never blocks
 * the in-memory flow. Restore validates contracts and contextual bindings. */
export function readAnalysisSession(storage: Storage): AnalysisSession | null {
  try {
    const raw = storage.getItem(ANALYSIS_SESSION_KEY);
    if (!raw) return null;
    if (raw.length > MAX_SESSION_LENGTH) throw new Error("Oversized session");
    const parsed = AnalysisSessionSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch { /* No input or diagnostics logged. */ }
  try { storage.removeItem(ANALYSIS_SESSION_KEY); } catch { /* Storage unavailable. */ }
  return null;
}
export function writeAnalysisSession(storage: Storage, session: AnalysisSession | null): void {
  try {
    if (!session) { storage.removeItem(ANALYSIS_SESSION_KEY); return; }
    const raw = JSON.stringify(session);
    if (raw.length > MAX_SESSION_LENGTH) throw new Error("Oversized session");
    storage.setItem(ANALYSIS_SESSION_KEY, raw);
  } catch {
    // Remove an older snapshot rather than restore stale results after a failed write.
    try { storage.removeItem(ANALYSIS_SESSION_KEY); } catch { /* Memory remains authoritative. */ }
  }
}
