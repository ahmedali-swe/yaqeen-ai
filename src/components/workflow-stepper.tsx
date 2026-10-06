import { Check, CircleAlert, LockKeyhole } from "lucide-react";
import { ANALYSIS_STAGES, hasInsufficientEvidence, stageAvailability, type AnalysisStage, type ClaimFlowState } from "./analysis-flow";

const labels = ["الادعاءات", "الأدلة", "العلاقة", "تحوّل المعنى", "تصحيح يقين"];
export function WorkflowStepper({ extracted, state, hasClaims = true, activeStage, onNavigate }: { extracted: boolean; state: ClaimFlowState; hasClaims?: boolean; activeStage?: AnalysisStage; onNavigate?: (stage: AnalysisStage) => void }) {
  const meaningAvailable = !!state.analysis && !!state.evidenceResult?.evidence.length && state.analysis.relationType !== "NONE";
  const terminal = hasInsufficientEvidence(state);
  const steps = terminal ? [...labels.slice(0, 3), "الأدلة غير كافية"] : labels;
  const complete = [extracted, !!state.evidenceResult, !!state.analysis, meaningAvailable, !!state.patch];
  if (terminal) complete[3] = false;
  const available = stageAvailability(state, extracted, hasClaims);
  const current = activeStage ? ANALYSIS_STAGES.indexOf(activeStage) : terminal ? -1 : !extracted ? 0 : !hasClaims ? -1 : !state.evidenceResult ? 1 : !state.analysis ? 2 : !state.patch ? 4 : -1;
  return <nav className={`workflow-stepper${terminal ? " is-terminal-flow" : ""}`} aria-label="مراحل التحليل"><ol>{steps.map((label, index) => <li key={label} className={terminal && index === 3 ? "is-terminal" : `${complete[index] ? "is-complete" : "is-future"}${current === index ? " is-current" : ""}`} aria-current={current === index ? "step" : undefined}>
    {terminal && index === 3 ? <><span className="step-marker"><CircleAlert size={15} aria-hidden="true" /></span><span>{label}<span className="sr-only"> — توقف التحليل</span></span></> : <button type="button" aria-label={label} disabled={!available[ANALYSIS_STAGES[index]]} onClick={() => onNavigate?.(ANALYSIS_STAGES[index])}>
      <span className="step-marker">{complete[index] ? <Check size={15} aria-hidden="true" /> : current === index ? (index + 1).toLocaleString("ar-SA") : <LockKeyhole size={13} aria-hidden="true" />}</span>
      <span>{label}<span className="sr-only">{complete[index] ? " — مكتمل" : current === index ? " — الخطوة الحالية" : " — لم يكتمل"}</span></span>
    </button>}
  </li>)}</ol></nav>;
}
