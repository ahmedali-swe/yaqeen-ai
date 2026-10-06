"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleHelp, CircleAlert, Scale, ShieldCheck } from "lucide-react";
import { RelationResultSchema, isBoundRelation, type RelationAnalysis } from "@/domain/evidence-reasoning";
import type { ExtractedClaim } from "@/domain/claim-extraction";
import type { EvidenceCandidate, EvidenceResolution } from "@/evidence/types";
import { TEMPORARY_AI_MESSAGE } from "@/lib/ai-messages";
import { InlineAlert } from "./inline-alert";
import { evidenceReferenceLabel } from "./evidence-card";
import type { EvidenceExplanation } from "@/evidence/explanations/types";

export type RelationTraceData = {
  claim: ExtractedClaim; evidence: EvidenceCandidate[]; analysis: RelationAnalysis;
  resolution?: EvidenceResolution; anchorClaim?: ExtractedClaim;
  approvedExplanations?: EvidenceExplanation[];
};
const errors: Record<string, string> = {
  AI_NOT_CONFIGURED: "خدمة التحليل غير متاحة حاليًا.",
  INVALID_AI_RESPONSE: "تعذر قراءة تحليل موثوق مرتبط بالأدلة. حاول مجددًا.",
  INVALID_INPUT: "تعذر تحليل هذه البيانات. راجع الادعاء والأدلة المقدمة.",
  INPUT_TOO_LARGE: "حجم الأدلة أكبر من المسموح للتحليل.",
};
export const verificationLabels = {
  SUPPORTED: "مدعوم", PARTIALLY_SUPPORTED: "مدعوم جزئيًا", NEEDS_CONTEXT: "يحتاج سياقًا",
  UNSUPPORTED: "غير مدعوم", REQUIRES_SPECIALIST: "يحتاج مراجعة مختص",
};
export const relationLabels = {
  DIRECT_QUOTE: "اقتباس مباشر", PARAPHRASE: "إعادة صياغة", MISSING_CONTEXT: "سياق مفقود",
  OVERGENERALIZATION: "تعميم يتجاوز الدليل", UNSUPPORTED_INFERENCE: "استنتاج غير مدعوم",
  MISATTRIBUTION: "نسبة غير دقيقة", TRANSLATION_DRIFT: "تغيّر المعنى أثناء الترجمة", NONE: "لا علاقة مثبتة",
};

export function RelationAnalysisAction({ claim, evidence, approvedExplanations, originalContent, initialAnalysis, onAnalysisChange, onRestart }: {
  claim: ExtractedClaim; evidence: EvidenceCandidate[]; originalContent?: string; initialAnalysis?: RelationAnalysis;
  onAnalysisChange?: (trace: RelationTraceData | null) => void;
  onRestart?: () => void;
  approvedExplanations?: EvidenceExplanation[];
}) {
  const [analysis, setAnalysis] = useState<RelationAnalysis | null>(initialAnalysis ?? null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  async function analyze(force = false) {
    if (pending.current || (analysis && !force)) return;
    if (force) { onRestart?.(); setAnalysis(null); }
    const controller = new AbortController(); pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 35_000);
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/analyze/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim, evidence, ...(approvedExplanations?.length ? { approvedExplanations } : {}), ...(originalContent !== undefined ? { originalContent } : {}) }), signal: controller.signal, cache: "no-store" });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const code = typeof raw === "object" && raw !== null && "error" in raw && typeof raw.error === "object" && raw.error !== null && "code" in raw.error && typeof raw.error.code === "string" ? raw.error.code : "AI_UNAVAILABLE";
        throw new Error(code);
      }
      const result = RelationResultSchema.safeParse(raw);
      if (!result.success || !isBoundRelation(result.data.analysis, { claim, evidence, originalContent })) throw new Error("INVALID_AI_RESPONSE");
      if (pending.current !== controller || controller.signal.aborted) return;
      setAnalysis(result.data.analysis); onAnalysisChange?.({ claim, evidence, approvedExplanations, analysis: result.data.analysis });
    } catch (cause) {
      if (pending.current === controller) setError(controller.signal.aborted ? TEMPORARY_AI_MESSAGE : errors[cause instanceof Error ? cause.message : ""] ?? TEMPORARY_AI_MESSAGE);
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  }
  return <div className="relation-action" aria-busy={loading}>
    <p className="safety-line"><ShieldCheck size={16} aria-hidden="true" />التحليل مبني على الأدلة المعروضة؛ النموذج ليس مصدرًا شرعيًا.</p>
    {!analysis && !error && <button type="button" className="evidence-button" onClick={() => analyze()} disabled={loading}>{loading ? "جارٍ تحليل العلاقة…" : "تحليل العلاقة"}</button>}
    {loading && <p role="status">جارٍ مقارنة الادعاء بالأدلة المقدمة…</p>}
    {error && <InlineAlert message={error} onRetry={() => analyze()} />}
    {analysis && onRestart && <button type="button" className="stage-restart" onClick={() => analyze(true)} disabled={loading}>إعادة تحليل العلاقة</button>}
    {analysis && !onAnalysisChange && <><VerificationSummary trace={{ claim, evidence, analysis }} /><RelationTrace trace={{ claim, evidence, analysis }} /><MeaningChange analysis={analysis} hasEvidence={!!evidence.length} hasExplanation={approvedExplanations?.some((item) => item.evidenceId === analysis.strongestEvidenceId)} strongestEvidence={evidence.find(item => item.id === analysis.strongestEvidenceId)} approvedExplanation={approvedExplanations?.find(item => item.evidenceId === analysis.strongestEvidenceId)} /></>}
  </div>;
}

export function VerificationSummary({ trace }: { trace: RelationTraceData }) {
  const { claim, analysis } = trace;
  const Icon = analysis.verificationStatus === "SUPPORTED" ? CheckCircle2 : analysis.requiresSpecialist ? Scale : analysis.verificationStatus === "UNSUPPORTED" ? CircleAlert : CircleHelp;
  return <section className={`verdict-summary status-${analysis.verificationStatus.toLowerCase()}`} aria-labelledby="verdict-title">
    <div className="verdict-heading"><Icon size={28} aria-hidden="true" /><div><h2 id="verdict-title">{verificationLabels[analysis.verificationStatus]}</h2><p>{relationLabels[analysis.relationType]}</p></div></div>
    <blockquote dir="auto">{claim.text}</blockquote><p>{analysis.reasoning}</p>
    {analysis.requiresSpecialist && <p className="specialist-notice">تحتاج هذه المسألة إلى مراجعة مختص؛ لم يصدر النظام فتوى أو حكمًا شخصيًا.</p>}
  </section>;
}

export function RelationTrace({ trace }: { trace: RelationTraceData }) {
  const { claim, evidence, analysis, anchorClaim } = trace;
  const strongest = evidence.find((item) => item.id === analysis.strongestEvidenceId);
  const context = trace.resolution?.evidenceOrigin === "CONTEXTUAL_ANCHOR" && anchorClaim;
  return <div className="relation-result" aria-label="مسار العلاقة بين الادعاء والدليل"><ol className="relation-trace">
    <li><h3>{context ? "الاقتباس الأصلي" : "الادعاء"}</h3><p dir="auto">{context ? anchorClaim.text : claim.text}</p></li>
    <li><h3>الدليل</h3><p>{strongest ? <>{strongest.sourceName} — <bdi>{evidenceReferenceLabel(strongest)}</bdi></> : "لم يُحدد دليل مناسب ضمن الأدلة المقدمة."}</p>{context && <small>دليل الاقتباس السابق، للمقارنة مع التفسير.</small>}</li>
    {context && <li><h3>التفسير المنشور</h3><p dir="auto">{claim.text}</p></li>}
    <li><h3>العلاقة بالدليل</h3><p>{relationLabels[analysis.relationType]}</p></li>
    <li><h3>موضع تغيّر المعنى</h3><p dir="auto">{analysis.unsupportedPart ?? analysis.missingContext ?? (analysis.verificationStatus === "SUPPORTED" ? "لم يحدد التحليل تجاوزًا للمعنى في الأدلة المقدمة." : "لا تكفي الأدلة لتحديد تغيّر في المعنى.")}</p></li>
  </ol></div>;
}

export function MeaningChange({ analysis, hasEvidence = true, hasExplanation = false, strongestEvidence, approvedExplanation }: { analysis: RelationAnalysis; hasEvidence?: boolean; hasExplanation?: boolean; strongestEvidence?: EvidenceCandidate; approvedExplanation?: EvidenceExplanation }) {
  if (!hasEvidence || analysis.relationType === "NONE") return <p className="evidence-help">تعذر تقييم تحوّل المعنى لعدم توفر دليل كافٍ.</p>;
  // Presentation copy only: stored analysis and approved source strings stay exact.
  const bukhari71Interpretation = analysis.relationType === "UNSUPPORTED_INFERENCE" && strongestEvidence?.id === "sahihayn-bukhari-71" && approvedExplanation?.evidenceId === strongestEvidence.id && approvedExplanation.sourceId === "5518";
  const summary = analysis.verificationStatus === "SUPPORTED" && analysis.relationType === "DIRECT_QUOTE"
    ? strongestEvidence?.sourceType === "HADITH" ? "الاقتباس مطابق للنص الوارد في الحديث." : "الاقتباس مطابق للنص المعروض."
    : bukhari71Interpretation ? "يدل الحديث على ارتباط إرادة الخير بالتفقه في الدين." : analysis.supportedMeaning;
  return <dl className="meaning-details">
    <div><dt>{hasExplanation ? "ما يدعمه الدليل والشرح المعتمد" : "الدليل يدعم"}</dt><dd><span>{summary}</span><p className="evidence-help"><small>{hasExplanation ? "خلاصة يقين مبنية على الدليل والشرح المعتمد، وليست اقتباسًا من نص الشرح." : "خلاصة يقين مبنية على الدليل المعروض، وليست اقتباسًا من نص المصدر."}</small></p></dd></div>
    <div><dt>المحتوى أضاف</dt><dd>{analysis.unsupportedPart ? <blockquote dir="auto">{analysis.unsupportedPart}</blockquote> : "لم يُحدد جزء يتجاوز الدليل."}</dd></div>
    <div><dt>نوع التحول</dt><dd>{relationLabels[analysis.relationType]}</dd></div>
    {analysis.missingContext && <div><dt>السياق المفقود</dt><dd>{analysis.missingContext}</dd></div>}
  </dl>;
}
