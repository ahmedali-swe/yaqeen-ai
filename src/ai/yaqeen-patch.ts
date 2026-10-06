import "server-only";
import { PatchInputSchema, PatchResultSchema, isBoundPatch, isVerbatimQuotePatch, isEvidenceBoundedInferencePatch, minimizePatchEdits, applyPatchChanges, type PatchInput, type PatchResult } from "@/domain/yaqeen-patch";
import { authenticateSahihaynEvidence } from "@/evidence/providers/local-sahihayn";
import { resolveApprovedExplanations } from "@/evidence/explanations/hadeethenc";
import { ExtractionError } from "./errors";
import { groqPatchProvider } from "./providers/groq-patch";
import { requiresPersonalSpecialist } from "@/domain/specialist-boundary";
import { requireGroqEnv } from "@/lib/env";
import { aiRequestKey, sharedAiResults, type AiExecutionOptions } from "./result-cache";
import { GroundingBudgetError } from "./grounding-payload";

export type ReadonlyPatchInput = Readonly<Omit<PatchInput, "claim" | "analysis" | "evidence"> & {
  claim: Readonly<PatchInput["claim"]>; analysis: Readonly<PatchInput["analysis"]>;
  evidence: readonly Readonly<PatchInput["evidence"][number]>[];
}>;
export interface PatchProvider { generate(input: ReadonlyPatchInput, signal: AbortSignal): Promise<unknown> }

function abstain(input: PatchInput, explanation: string): PatchResult {
  return { patch: { action: "NO_SAFE_PATCH", originalText: input.claim.text, proposedText: null, changes: [],
    preservedIntent: "لم يُغيّر النص الأصلي؛ لا نفرض تصحيحًا غير مستند إلى الأدلة.", evidenceIds: [], explanation } };
}

export async function generateYaqeenPatch(input: PatchInput, provider: PatchProvider = groqPatchProvider, parentSignal?: AbortSignal, execution?: AiExecutionOptions): Promise<PatchResult> {
  const validated = PatchInputSchema.parse(input);
  if (parentSignal?.aborted) throw new ExtractionError("AI_TIMEOUT");
  if (requiresPersonalSpecialist(validated.claim) || validated.analysis.requiresSpecialist) return { patch: { action: "REFER_SPECIALIST", originalText: validated.claim.text, proposedText: null,
    changes: [], preservedIntent: "يُحفظ السؤال دون إصدار حكم شخصي.", evidenceIds: [], explanation: "تحتاج المسألة إلى مراجعة مختص؛ لا يقترح يقين فتوى أو تصحيحًا لحكم شخصي." } };
  if (!validated.evidence.length || validated.analysis.strongestEvidenceId === null || validated.analysis.relationType === "NONE") return abstain(validated, "لا تتوفر أدلة كافية ضمن المصادر المتاحة لاقتراح تصحيح آمن.");
  if (validated.analysis.verificationStatus === "SUPPORTED") return abstain(validated, "الادعاء أمين للأدلة المقدمة؛ لا يحتاج إلى تصحيح يقين.");
  let authenticated: PatchInput["evidence"] | null;
  try { authenticated = await authenticateSahihaynEvidence(validated.evidence); }
  catch { throw new ExtractionError("AI_UNAVAILABLE"); }
  if (!authenticated) return abstain(validated, "تصحيح يقين متاح حاليًا للنصوص المطابقة للفهرس المحلي للصحيحين فقط. لا تكفي بيانات مصدر غير موثّقة لفرض تصحيح.");
  const approved = await resolveApprovedExplanations(authenticated, validated.originalContent ?? validated.claim.text);
  if ((["INTERPRETATION", "RULING"].includes(validated.claim.claimType) || validated.analysis.relationType === "UNSUPPORTED_INFERENCE") && !approved.explanations.some((item) => item.evidenceId === validated.analysis.strongestEvidenceId)) return abstain(validated, "لم يتوفر شرح معتمد كافٍ لتقييم هذا التفسير بثقة.");
  if (parentSignal?.aborted) throw new ExtractionError("AI_TIMEOUT");
  const snapshot = Object.freeze({ ...validated, approvedExplanations: Object.freeze(approved.explanations.map((item) => Object.freeze({ ...item, hints: Object.freeze([...item.hints]) as unknown as string[] }))) as unknown as PatchInput["approvedExplanations"], claim: Object.freeze(validated.claim), analysis: Object.freeze(validated.analysis),
    evidence: Object.freeze(authenticated.map((item) => Object.freeze({ ...item, metadata: Object.freeze(item.metadata) }))) });
  const boundInput = { ...validated, evidence: authenticated, approvedExplanations: approved.explanations };
  if (provider !== groqPatchProvider) return generateOnce(snapshot, boundInput, provider, parentSignal);
  const { GROQ_TEXT_MODEL } = requireGroqEnv(process.env);
  return sharedAiResults.run(aiRequestKey("yaqeen-patch", GROQ_TEXT_MODEL, snapshot), (signal) => generateOnce(snapshot, boundInput, provider, signal), parentSignal, execution);
}

async function generateOnce(snapshot: ReadonlyPatchInput, input: PatchInput, provider: PatchProvider, parentSignal?: AbortSignal): Promise<PatchResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(new ExtractionError("AI_TIMEOUT")); };
    parentSignal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, 30_000);
  });
  try {
    const raw = await Promise.race([provider.generate(snapshot, controller.signal), interrupted]);
    if (controller.signal.aborted) throw new ExtractionError("AI_TIMEOUT");
    const result = PatchResultSchema.safeParse(raw);
    if (!result.success || !isBoundPatch(result.data.patch, input)) {
      if (process.env.NODE_ENV === "development") console.info("[Yaqeen: Patch output rejected]", {
        schemaValid: result.success,
        ...(result.success ? { originalMatches: result.data.patch.originalText === input.claim.text,
          editScriptMatches: applyPatchChanges(input.claim.text, result.data.patch.changes) === result.data.patch.proposedText,
          evidenceBound: result.data.patch.evidenceIds.every(id => id === input.analysis.strongestEvidenceId),
          mutationBound: result.data.patch.changes.every(change => change.mutationType === input.analysis.relationType) } : {}),
      });
      throw new ExtractionError("INVALID_AI_RESPONSE");
    }
    if (provider === groqPatchProvider && result.data.patch.evidenceIds.some(id => id !== snapshot.analysis.strongestEvidenceId)) throw new ExtractionError("INVALID_AI_RESPONSE");
    if (!isVerbatimQuotePatch(result.data.patch, input)) return abstain(input, "لا يُعاد صياغة النص الديني المقتبس. لم تتطابق الصياغة المقترحة حرفيًا مع الدليل؛ يُحفظ النص الأصلي للمراجعة.");
    if (!isEvidenceBoundedInferencePatch(result.data.patch, input)) return abstain(input, "غياب الاستدلال لا يثبت نقيض الادعاء. تعذر اعتماد تعديل يتجاوز الدليل والشرح المعتمد.");
    return { patch: minimizePatchEdits(result.data.patch, input) };
  } catch (error) {
    if (error instanceof GroundingBudgetError) return abstain(input, "لا يمكن تضمين الدليل والشرح اللازمين ضمن حدود التحليل الآمن؛ لا يُقترح تصحيح دون سياق كافٍ.");
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(controller.signal.aborted ? "AI_TIMEOUT" : "AI_UNAVAILABLE");
  } finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", abort); controller.abort(); }
}
