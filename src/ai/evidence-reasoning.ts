import "server-only";
import { RelationInputSchema, RelationResultSchema, isBoundRelation, type ReadonlyRelationInput, type RelationInput, type RelationResult } from "@/domain/evidence-reasoning";
import { ExtractionError } from "./errors";
import { groqReasoningProvider } from "./providers/groq-reasoning";
import { requiresPersonalSpecialist } from "@/domain/specialist-boundary";
import { requireGroqEnv } from "@/lib/env";
import { aiRequestKey, sharedAiResults, type AiExecutionOptions } from "./result-cache";
import { resolveApprovedExplanations } from "@/evidence/explanations/hadeethenc";
import { GroundingBudgetError, strongestEvidence } from "./grounding-payload";

export interface EvidenceReasoningProvider {
  analyze(input: ReadonlyRelationInput, signal: AbortSignal): Promise<unknown>;
}
export const REASONING_TIMEOUT_MS = 30_000;

function restrictedAnalysis(evidenceId: string, budget = false): RelationResult {
  const explanation = budget ? "لا يمكن تضمين الدليل والشرح اللازمين كاملين ضمن حدود التحليل الآمن؛ يلزم سياق إضافي." : "لم يتوفر شرح معتمد كافٍ لتقييم هذا التفسير بثقة.";
  return { analysis: {
    verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: evidenceId,
    supportedMeaning: explanation, unsupportedPart: null,
    missingContext: explanation,
    reasoning: explanation, requiresSpecialist: false,
  } };
}

function immutableSnapshot(input: RelationInput): ReadonlyRelationInput {
  return Object.freeze({ ...input, claim: Object.freeze(input.claim), evidence: Object.freeze(input.evidence.map((item) => Object.freeze({ ...item, metadata: Object.freeze(item.metadata) }))), approvedExplanations: Object.freeze((input.approvedExplanations ?? []).map((item) => Object.freeze({ ...item, hints: Object.freeze([...item.hints]) as unknown as string[] }))) });
}

export async function analyzeEvidenceRelation(input: RelationInput, provider: EvidenceReasoningProvider = groqReasoningProvider, parentSignal?: AbortSignal, execution?: AiExecutionOptions): Promise<RelationResult> {
  // Zod clones the caller's objects; freeze the snapshot handed to the provider.
  let snapshot = immutableSnapshot(RelationInputSchema.parse(input));
  if (parentSignal?.aborted) throw new ExtractionError("AI_TIMEOUT");
  if (requiresPersonalSpecialist(snapshot.claim)) return { analysis: {
    verificationStatus: "REQUIRES_SPECIALIST", relationType: "NONE", strongestEvidenceId: null,
    supportedMeaning: "لا تكفي المقارنة النصية لإصدار حكم ديني على حالة شخصية.", unsupportedPart: null,
    missingContext: "تحتاج ظروف الحالة الشخصية وتطبيق الحكم إلى مراجعة مختص.",
    reasoning: "الادعاء يتعلق بتطبيق ديني على حالة شخصية؛ يحيل يقين هذه المسألة إلى مختص دون فتوى.", requiresSpecialist: true,
  } };
  if (!snapshot.evidence.length) return { analysis: {
    verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: null,
    supportedMeaning: "لم تُقدَّم أدلة يمكن تحديد معنى مدعوم منها.", unsupportedPart: null,
    missingContext: "يلزم دليل من مصدر معتمد قبل تقييم العلاقة بهذا الادعاء.",
    reasoning: "غياب الأدلة المقدمة يمنع تقييم أمانة النقل أو الاستدلال؛ لا يمثل ذلك حكمًا على صحة الادعاء.", requiresSpecialist: false,
  } };
  // Browser-provided approval metadata is never proof. Resolve authoritative
  // exact source text on the server (shared bounded source cache, no AI call).
  const approved = await resolveApprovedExplanations([...snapshot.evidence], snapshot.originalContent ?? snapshot.claim.text);
  if (parentSignal?.aborted) throw new ExtractionError("AI_TIMEOUT");
  snapshot = immutableSnapshot({ ...RelationInputSchema.parse(input), approvedExplanations: approved.explanations });
  if (["INTERPRETATION", "RULING"].includes(snapshot.claim.claimType) && snapshot.evidence.some((item) => item.sourceType === "HADITH") && !approved.explanations.length) return restrictedAnalysis(snapshot.evidence[0].id);
  if (provider !== groqReasoningProvider) return analyzeOnce(snapshot, provider, parentSignal);
  const selected = strongestEvidence(snapshot);
  if (["INTERPRETATION", "RULING"].includes(snapshot.claim.claimType) && selected.sourceType === "HADITH" && !approved.explanations.some(item => item.evidenceId === selected.id)) return restrictedAnalysis(selected.id);
  const { GROQ_TEXT_MODEL } = requireGroqEnv(process.env);
  return sharedAiResults.run(aiRequestKey("evidence-reasoning", GROQ_TEXT_MODEL, snapshot), (signal) => analyzeOnce(snapshot, provider, signal), parentSignal, execution);
}

async function analyzeOnce(snapshot: ReadonlyRelationInput, provider: EvidenceReasoningProvider, parentSignal?: AbortSignal): Promise<RelationResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(new ExtractionError("AI_TIMEOUT")); };
    parentSignal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, REASONING_TIMEOUT_MS);
  });
  try {
    const raw = await Promise.race([provider.analyze(snapshot, controller.signal), interrupted]);
    if (controller.signal.aborted) throw new ExtractionError("AI_TIMEOUT");
    const result = RelationResultSchema.safeParse(raw);
    if (!result.success || !isBoundRelation(result.data.analysis, snapshot)) throw new ExtractionError("INVALID_AI_RESPONSE");
    if (provider === groqReasoningProvider && result.data.analysis.strongestEvidenceId !== null && result.data.analysis.strongestEvidenceId !== strongestEvidence(snapshot).id) throw new ExtractionError("INVALID_AI_RESPONSE");
    const strongest = snapshot.evidence.find((item) => item.id === result.data.analysis.strongestEvidenceId);
    if (["INTERPRETATION", "RULING"].includes(snapshot.claim.claimType) && strongest?.sourceType === "HADITH" && !snapshot.approvedExplanations?.some((item) => item.evidenceId === strongest.id)) return restrictedAnalysis(strongest.id);
    return result.data;
  } catch (error) {
    if (error instanceof GroundingBudgetError) return restrictedAnalysis(strongestEvidence(snapshot).id, true);
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(controller.signal.aborted ? "AI_TIMEOUT" : "AI_UNAVAILABLE");
  } finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", abort); controller.abort(); }
}
