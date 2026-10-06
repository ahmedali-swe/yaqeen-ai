"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import type { ClaimExtractionResult } from "@/domain/claim-extraction";
import { ClaimResults } from "./claim-results";
import { EvidenceResults } from "./evidence-results";
import { RelationAnalysisAction, RelationTrace, MeaningChange, VerificationSummary, type RelationTraceData } from "./relation-analysis";
import { YaqeenPatchAction } from "./yaqeen-patch";
import { WorkflowStepper } from "./workflow-stepper";
import { emptyReport, hasInsufficientEvidence, INSUFFICIENT_EVIDENCE_MESSAGE, invalidateStage, nextStage, stageAvailability, type AnalysisStage, type ClaimFlowState, type ReportState } from "./analysis-flow";

function FutureStage({ title, id }: { title: string; id: string }) {
  return <section className="future-stage" aria-labelledby={`${id}-title`}><LockKeyhole size={17} aria-hidden="true" /><h2 id={`${id}-title`}>{title}</h2><p>يظهر بعد تحليل العلاقة.</p></section>;
}
export function AnalysisEmptyStates({ extraction = null, originalContent, report: controlledReport, onReportChange }: {
  extraction?: ClaimExtractionResult | null; originalContent?: string;
  report?: ReportState; onReportChange?: (update: (previous: ReportState) => ReportState) => void;
}) {
  const claims = extraction?.claims ?? [];
  const [localReport, setLocalReport] = useState<ReportState>(emptyReport);
  const report = controlledReport ?? localReport, updateReport = onReportChange ?? setLocalReport;
  const selectedId = claims.some((claim) => claim.id === report.selectedClaimId) ? report.selectedClaimId : claims[0]?.id ?? "";
  const claim = claims.find((item) => item.id === selectedId), state = report.states[selectedId] ?? {};
  const available = stageAvailability(state, extraction !== null, claims.length > 0);
  const requestedStage = report.activeStages[selectedId] ?? nextStage(state);
  const stage = available[requestedStage] ? requestedStage : nextStage(state);
  const terminal = hasInsufficientEvidence(state);
  const trace: RelationTraceData | null = claim && state.analysis ? {
    claim, evidence: state.evidenceResult?.evidence ?? [], analysis: state.analysis,
    resolution: state.evidenceResult?.resolution,
    approvedExplanations: state.evidenceResult?.explanations,
    anchorClaim: claims.find((item) => item.id === state.evidenceResult?.resolution?.evidenceAnchorClaimId),
  } : null;
  function navigate(target: AnalysisStage) {
    if (!claim || !available[target]) return;
    updateReport((previous) => ({ ...previous, selectedClaimId: selectedId, activeStages: { ...previous.activeStages, [selectedId]: target } }));
  }
  function save(next: ClaimFlowState, target?: AnalysisStage) {
    updateReport((previous) => ({ ...previous, selectedClaimId: selectedId,
      states: { ...previous.states, [selectedId]: next },
      activeStages: { ...previous.activeStages, [selectedId]: target ?? nextStage(next) },
    }));
  }
  function restart(target: AnalysisStage) { save(invalidateStage(state, target), target === "meaning" ? "relation" : target); }
  return <>
    <WorkflowStepper extracted={extraction !== null} state={state} hasClaims={claims.length > 0} activeStage={claims.length ? stage : undefined} onNavigate={navigate} />
    <div className="results-grid">
      <aside className="claims-sidebar"><section className="result-card" aria-labelledby="claims-title"><div className="result-heading"><h2 id="claims-title">الادعاءات المستخرجة</h2>{claims.length > 0 && <span>{claims.length.toLocaleString("ar")}</span>}</div>
        {claims.length ? <><p className="evidence-help">اختر ادعاءً لعرض مراحله المحفوظة.</p><ClaimResults claims={claims} selectedId={selectedId} onSelect={(id) => updateReport((previous) => ({ ...previous, selectedClaimId: id }))} /></> : <div className="claims-empty"><h3>{extraction ? "لم يُستخرج ادعاء قابل للفحص" : "لا توجد ادعاءات مستخرجة بعد"}</h3><p>{extraction ? "لم يحدد التحليل ادعاءات مستقلة قابلة للفحص. هذا لا يُعد حكمًا على صحة النص." : "أرسل نصًا من الصفحة الرئيسية. لا توجد نتيجة محفوظة في هذه الجلسة."}</p></div>}
      </section></aside>
      <div className="report-pane" key={`${selectedId}:${stage}`}>
        {state.evidenceResult?.resolution?.evidenceOrigin === "CONTEXTUAL_ANCHOR" && stage !== "evidence" && <div className="contextual-evidence"><strong>الدليل المشار إليه في السياق</strong><p>استخدم يقين الدليل المرتبط بالادعاء السابق لتقييم هذا الاستنتاج.</p></div>}
        {claim && stage === "claims" && <section className="result-card" aria-labelledby="selected-claim-title"><h2 id="selected-claim-title">الادعاء المحدد</h2><blockquote dir="auto">{claim.text}</blockquote><button type="button" className="evidence-button" onClick={() => navigate("evidence")}>عرض الأدلة</button></section>}
        {(!claim || stage === "evidence") && <section className="result-card" aria-labelledby="evidence-title"><div className="result-heading"><h2 id="evidence-title">المصدر والدليل</h2></div>
          {claim ? <><EvidenceResults key={selectedId} claims={claims} selectedClaimId={selectedId} originalContent={originalContent} value={state} onChange={(next) => save(next)} showReasoning={false} onRestart={() => restart("evidence")} />
            {state.evidenceResult && <div className="stage-actions"><button type="button" className="evidence-button" onClick={() => navigate("relation")}>عرض العلاقة</button></div>}</> : <p className="evidence-help">اختر ادعاءً بعد إدخال المحتوى للعثور على دليله.</p>}
        </section>}
        {claim && stage === "relation" && state.evidenceResult && <>
          {trace && <VerificationSummary trace={trace} />}
          <section className="result-card lineage-card" aria-labelledby="trail-title"><div className="result-heading"><h2 id="trail-title">مسار الدليل</h2></div>
            <RelationAnalysisAction key={selectedId} claim={claim} evidence={state.evidenceResult.evidence} approvedExplanations={state.evidenceResult.explanations} originalContent={originalContent} initialAnalysis={state.analysis} onAnalysisChange={(result) => save({ ...state, analysis: result?.analysis, patch: undefined }, "relation")} onRestart={() => restart("relation")} />
            {trace && <><RelationTrace trace={trace} /><div className="stage-actions">{available.meaning && <button type="button" className="evidence-button" onClick={() => navigate("meaning")}>عرض تحوّل المعنى</button>}{available.patch && !available.meaning && <button type="button" className="evidence-button" onClick={() => navigate("patch")}>عرض تصحيح يقين</button>}</div></>}
          </section>
          {terminal && <section className="result-card" aria-labelledby="terminal-title"><h2 id="terminal-title">تعذر الاستكمال</h2><p className="evidence-help" role="status">{INSUFFICIENT_EVIDENCE_MESSAGE}</p></section>}
        </>}
        {trace && stage === "meaning" && <section className="result-card" aria-labelledby="meaning-title"><div className="result-heading"><h2 id="meaning-title">تحوّل المعنى</h2></div><MeaningChange analysis={trace.analysis} hasEvidence={!!trace.evidence.length} hasExplanation={trace.approvedExplanations?.some((item) => item.evidenceId === trace.analysis.strongestEvidenceId)} strongestEvidence={trace.evidence.find(item => item.id === trace.analysis.strongestEvidenceId)} approvedExplanation={trace.approvedExplanations?.find(item => item.evidenceId === trace.analysis.strongestEvidenceId)} /><div className="stage-actions"><button type="button" className="evidence-button" onClick={() => navigate("patch")}>عرض تصحيح يقين</button></div></section>}
        {trace && stage === "patch" && <section className="result-card patch-result" aria-labelledby="patch-title"><div className="result-heading"><h2 id="patch-title">تصحيح يقين</h2></div><YaqeenPatchAction key={selectedId} trace={trace} originalContent={originalContent} initialPatch={state.patch} onPatchChange={(patch) => save({ ...state, patch }, "patch")} onRestart={() => restart("patch")} /></section>}
        {!claim && <><FutureStage title="مسار الدليل" id="trail" /><FutureStage title="تحوّل المعنى" id="meaning" /><FutureStage title="تصحيح يقين" id="patch" /></>}
      </div>
    </div>
  </>;
}
