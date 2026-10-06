"use client";

import { useEffect, useRef, useState } from "react";
import { PatchResultSchema, isBoundPatch, isVerbatimQuotePatch, type Patch } from "@/domain/yaqeen-patch";
import type { RelationTraceData } from "./relation-analysis";
import { TEMPORARY_AI_MESSAGE } from "@/lib/ai-messages";
import { InlineAlert } from "./inline-alert";

function DiffText({ text, other, mode }: { text: string; other: string; mode: "before" | "after" }) {
  let start = 0, end = 0;
  while (start < Math.min(text.length, other.length) && text[start] === other[start]) start++;
  while (end < text.length - start && end < other.length - start && text[text.length - end - 1] === other[other.length - end - 1]) end++;
  return <>{text.slice(0, start)}{mode === "before" ? <del>{text.slice(start, text.length - end)}</del> : <ins>{text.slice(start, text.length - end)}</ins>}{end ? text.slice(-end) : ""}</>;
}
export function YaqeenPatchAction({ trace, originalContent, initialPatch, onPatchChange, onRestart }: {
  trace: RelationTraceData; originalContent?: string; initialPatch?: Patch; onPatchChange?: (patch: Patch) => void;
  onRestart?: () => void;
}) {
  const [patch, setPatch] = useState<Patch | null>(initialPatch ?? null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  const noChangeRequired = trace.analysis.verificationStatus === "SUPPORTED" && ["DIRECT_QUOTE", "PARAPHRASE"].includes(trace.analysis.relationType) && trace.analysis.unsupportedPart === null && trace.analysis.missingContext === null;
  const hasExplanation = trace.approvedExplanations?.some(item => item.evidenceId === trace.analysis.strongestEvidenceId);
  const reverseInference = trace.analysis.strongestEvidenceId === "sahihayn-bukhari-71" && trace.approvedExplanations?.some(item => item.evidenceId === trace.analysis.strongestEvidenceId && item.sourceId === "5518") && trace.analysis.unsupportedPart?.includes("لا يريد");
  const conciseReason = {
    DIRECT_QUOTE: "لضبط الاقتباس وفق النص المعروض.",
    PARAPHRASE: "لحفظ معنى الدليل وحدوده.",
    MISSING_CONTEXT: "لإظهار السياق المؤثر الذي حذفه النص.",
    OVERGENERALIZATION: "لأن النص وسّع المعنى خارج حدود الدليل.",
    UNSUPPORTED_INFERENCE: reverseInference ? "لأن الدليل والشرح المعتمد لا يثبتان الاستنتاج العكسي الوارد في النص." : hasExplanation ? "لأن الدليل والشرح المعتمد لا يثبتان الاستنتاج الوارد في النص." : "لأن الدليل المعروض لا يثبت الاستنتاج الوارد في النص.",
    MISATTRIBUTION: "لتصحيح النسبة وفق المصدر المعروض.",
    TRANSLATION_DRIFT: "لحفظ معنى النص وحدوده في الترجمة.",
    NONE: "لا تكفي الأدلة المعروضة لتبرير تعديل موثوق.",
  }[trace.analysis.relationType];
  async function generate(force = false) {
    if (noChangeRequired || pending.current || (patch && !force)) return;
    if (force) { onRestart?.(); setPatch(null); }
    const controller = new AbortController(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35_000);
    setLoading(true); setError(null);
    // UI provenance stays outside the strict reasoning/Patch contract.
    const input = { claim: trace.claim, evidence: trace.evidence, analysis: trace.analysis, ...(trace.approvedExplanations?.length ? { approvedExplanations: trace.approvedExplanations } : {}), ...(originalContent !== undefined ? { originalContent } : {}) };
    try {
      const response = await fetch("/api/analyze/patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal, cache: "no-store" });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error("AI_UNAVAILABLE");
      const parsed = PatchResultSchema.safeParse(raw);
      if (!parsed.success || !isBoundPatch(parsed.data.patch, input) || !isVerbatimQuotePatch(parsed.data.patch, input)) throw new Error("INVALID_AI_RESPONSE");
      if (pending.current === controller && !controller.signal.aborted) { setPatch(parsed.data.patch); onPatchChange?.(parsed.data.patch); }
    } catch (cause) {
      if (pending.current === controller) setError(cause instanceof Error && cause.message === "INVALID_AI_RESPONSE" ? "تعذر قراءة تصحيح آمن مرتبط بالأدلة. حاول مجددًا." : TEMPORARY_AI_MESSAGE);
    } finally { clearTimeout(timeout); if (pending.current === controller) { pending.current = null; setLoading(false); } }
  }
  if (noChangeRequired) return <div className="patch-panel" aria-busy={false}><div className="patch-output patch-no_safe_patch">
    <h3>لا يحتاج إلى تصحيح</h3>
    <dl className="patch-details"><div><dt>السبب</dt><dd>{trace.analysis.relationType === "DIRECT_QUOTE" ? "الاقتباس أمين للنص المعروض ولا يتطلب تعديلًا." : "المحتوى أمين للمعنى المعروض ولا يتطلب تعديلًا."}</dd></div>
      {patch && <div><dt>ما الذي حافظنا عليه؟</dt><dd>{patch.preservedIntent}</dd></div>}
    </dl>
  </div></div>;
  return <div className="patch-panel" aria-busy={loading}>
    {!patch && <p className="evidence-help">أقل تعديل أمين للدليل، مع حفظ الاقتباس. الاقتراح للمراجعة ولا يُطبّق تلقائيًا.</p>}
    {!patch && !error && <button type="button" className="evidence-button" disabled={loading} onClick={() => generate()}>{loading ? "جارٍ إعداد تصحيح يقين…" : "اقتراح تصحيح يقين"}</button>}
    {loading && <p role="status">جارٍ إعداد تعديل مرتبط بالدليل…</p>}
    {error && <InlineAlert message={error} onRetry={() => generate()} />}
    {patch && onRestart && <button type="button" className="stage-restart" onClick={() => generate(true)} disabled={loading}>إعادة إعداد تصحيح يقين</button>}
    {patch && <div className={`patch-output patch-${patch.action.toLowerCase()}`}>
      <h3>{patch.action === "PATCH" ? "تعديل مقترح للمراجعة" : patch.action === "REFER_SPECIALIST" ? "يحتاج مراجعة مختص" : "تعذر اقتراح تصحيح موثوق"}</h3>
      {patch.action === "PATCH" && <div className="patch-comparison"><div><h4>قبل</h4><blockquote dir="auto"><DiffText text={patch.originalText} other={patch.proposedText!} mode="before" /></blockquote></div><div><h4>بعد</h4><blockquote dir="auto"><DiffText text={patch.proposedText!} other={patch.originalText} mode="after" /></blockquote></div></div>}
      {patch.action === "REFER_SPECIALIST" && <p>لن يقترح يقين تعديلًا تلقائيًا لهذه المسألة؛ تُحال إلى مختص.</p>}
      <dl className="patch-details"><div><dt>{patch.action === "PATCH" ? "لماذا تغير؟" : "السبب"}</dt><dd>{patch.action === "PATCH" ? conciseReason : patch.explanation}</dd></div><div><dt>ما الذي حافظنا عليه؟</dt><dd>{patch.preservedIntent}</dd></div></dl>
      {!!patch.changes.length && <details className="patch-edit-details"><summary>تفاصيل التعديل</summary><ul>{patch.changes.map((change, index) => <li key={index}>{change.reason.length > 220 || trace.approvedExplanations?.some(item => item.exactExplanation.includes(change.reason)) ? conciseReason : change.reason}</li>)}</ul></details>}
    </div>}
  </div>;
}
