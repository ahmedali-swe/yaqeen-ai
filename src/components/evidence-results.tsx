"use client";

import { useEffect, useRef, useState } from "react";
import type { ExtractedClaim } from "@/domain/claim-extraction";
import { EvidenceResultSchema } from "@/evidence/types";
import { RelationAnalysisAction, type RelationTraceData } from "./relation-analysis";
import { resolveEvidenceAnchor } from "@/domain/claim-context";
import { EvidenceCard } from "./evidence-card";
import { InlineAlert } from "./inline-alert";
import type { ClaimFlowState } from "./analysis-flow";

export function EvidenceResults({ claims, originalContent, selectedClaimId, value, onChange, onAnalysisChange, showReasoning = true, onRestart }: {
  claims: ExtractedClaim[]; originalContent?: string; selectedClaimId?: string;
  value?: ClaimFlowState; onChange?: (value: ClaimFlowState) => void; onAnalysisChange?: (trace: RelationTraceData | null) => void;
  showReasoning?: boolean;
  onRestart?: () => void;
}) {
  const [localSelectedId, setLocalSelectedId] = useState(claims[0]?.id ?? "");
  const selectedId = selectedClaimId ?? localSelectedId;
  const [localStates, setLocalStates] = useState<Record<string, ClaimFlowState>>({});
  const state = value ?? localStates[selectedId] ?? {};
  const claim = claims.find((item) => item.id === selectedId);
  const evidence = state.evidenceResult?.evidence;
  const retrieval = state.evidenceResult?.retrieval;
  const explanations = state.evidenceResult?.explanations;
  const strongest = evidence?.find((item) => item.id === state.analysis?.strongestEvidenceId) ?? evidence?.[0];
  const secondary = evidence?.filter((item) => item.id !== strongest?.id) ?? [];
  const card = (item: NonNullable<typeof strongest>) => <EvidenceCard key={item.id} evidence={item} anchorText={anchorClaim?.text ?? claim?.text} anchorClaimType={(anchorClaim ?? claim)?.claimType} explanation={explanations?.find((entry) => entry.evidenceId === item.id)} />;
  const anchor = claim ? resolveEvidenceAnchor(claim, claims, originalContent) : null;
  const anchorClaim = claims.find((item) => item.id === state.evidenceResult?.resolution?.evidenceAnchorClaimId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  function update(next: Partial<ClaimFlowState>) {
    const updated = { ...state, ...next };
    setLocalStates((previous) => ({ ...previous, [selectedId]: updated })); onChange?.(updated);
  }

  async function retrieve() {
    if (!claim) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setLoading(true); setError(null);
    try {
      const context = originalContent ? { claims, originalContent, evidenceAnchorClaimId: anchor?.evidenceAnchorClaimId ?? null } : undefined;
      const response = await fetch("/api/analyze/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim, ...(context ? { context } : {}) }), signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 429 ? "RATE_LIMITED" : response.status === 504 ? "TIMEOUT" : "UNAVAILABLE");
      const parsed = EvidenceResultSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("INVALID_RESPONSE");
      if (parsed.data.resolution?.evidenceOrigin === "CONTEXTUAL_ANCHOR" && (!anchor || parsed.data.resolution.evidenceAnchorClaimId !== anchor.evidenceAnchorClaimId || parsed.data.evidence.some((item) => anchor.sourceType === "HADITH" ? item.sourceType !== "HADITH" : anchor.sourceType === "QURAN" && item.sourceType === "HADITH"))) throw new Error("INVALID_RESPONSE");
      if (pending.current === controller && !controller.signal.aborted) { update({ evidenceResult: parsed.data, analysis: undefined, patch: undefined }); onAnalysisChange?.(null); }
    } catch (cause) {
      if (pending.current === controller) setError(cause instanceof Error && cause.message === "RATE_LIMITED" ? "الخدمة مشغولة حاليًا. حاول مجددًا بعد لحظات." : "تعذّر جلب الأدلة مؤقتًا. يمكنك إعادة البحث دون فقدان نتائج المراحل الأخرى.");
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  }

  return <div className="evidence-panel" aria-busy={loading}>
    {selectedClaimId === undefined && <><label htmlFor="evidence-claim">اختر الادعاء للبحث عن دليل</label>
    <select id="evidence-claim" value={selectedId} onChange={(event) => {
      pending.current?.abort(); pending.current = null;
      setLocalSelectedId(event.target.value); setError(null); setLoading(false); onAnalysisChange?.(null);
    }}>{claims.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.text}</option>)}</select></>}
    {!state.evidenceResult && !error && <><p className="evidence-help">يبحث يقين في المصادر المتاحة والمعتمدة للعثور على الدليل المرتبط بالادعاء.</p>
    <button type="button" className="evidence-button" disabled={loading || !selectedId} onClick={retrieve}>{loading ? "جارٍ البحث عن الأدلة…" : "البحث عن الأدلة"}</button></>}
    {loading && <p role="status">جارٍ استرجاع النصوص من المصادر المعتمدة…</p>}
    {error && <InlineAlert message={error} onRetry={retrieve} />}
    {evidence && !evidence.length && <p role="status">لا تتوفر أدلة كافية ضمن المصادر المتاحة. هذا لا يثبت صحة الادعاء أو بطلانه.</p>}
    {state.evidenceResult?.resolution?.evidenceOrigin === "CONTEXTUAL_ANCHOR" && <div className="contextual-evidence"><strong>الدليل المشار إليه في السياق</strong><p>استخدم يقين الدليل المرتبط بالادعاء السابق لتقييم هذا الاستنتاج.</p></div>}
    {(retrieval?.dorar === "UNAVAILABLE" || retrieval?.quranpedia === "UNAVAILABLE" || evidence?.some((item) => item.metadata.retrievalIncomplete)) && <p className="evidence-help" role="status">تعذّر الوصول إلى أحد المصادر؛ هذه نتائج المصادر المتاحة فقط.</p>}
    {strongest && <div className="evidence-list">{card(strongest)}{!!secondary.length && <details className="source-disclosure"><summary>أدلة مرتبطة أخرى ({secondary.length})</summary>{secondary.map(card)}</details>}</div>}
    {state.evidenceResult?.explanationStatus && state.evidenceResult.explanationStatus !== "AVAILABLE" && <p className="evidence-help">{state.evidenceResult.explanationStatus === "UNAVAILABLE" ? "تعذر جلب الشرح المعتمد مؤقتًا؛ يبقى نص الحديث متاحًا." : "لم يتوفر شرح معتمد مطابق لهذا الدليل."}</p>}
    {state.evidenceResult && onRestart && <button type="button" className="stage-restart" disabled={loading} onClick={() => { onRestart(); void retrieve(); }}>إعادة البحث عن الأدلة</button>}
    {showReasoning && evidence !== undefined && claim && <RelationAnalysisAction key={JSON.stringify([selectedId, evidence])} claim={claim} evidence={evidence} approvedExplanations={explanations} originalContent={originalContent} initialAnalysis={state.analysis} onAnalysisChange={(trace) => { update({ analysis: trace?.analysis, patch: undefined }); onAnalysisChange?.(trace); }} />}
  </div>;
}
