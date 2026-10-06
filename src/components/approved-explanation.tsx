import type { EvidenceExplanation } from "@/evidence/explanations/types";

/** Exact source excerpt, explicitly separate from Yaqeen's generated analysis. */
export function ApprovedExplanation({ explanation }: { explanation: EvidenceExplanation }) {
  const full = explanation.exactExplanation;
  const boundary = full.length > 300 ? full.lastIndexOf(" ", 300) : full.length;
  const excerpt = full.slice(0, boundary > 0 ? boundary : 300);
  return <details className="source-disclosure approved-explanation"><summary>الشرح المعتمد</summary>
    <p className="evidence-help">{explanation.sourceName}</p>
    <blockquote dir="auto">{excerpt}</blockquote>
    {excerpt !== full && <details className="source-disclosure"><summary>عرض الشرح كاملًا</summary><blockquote dir="auto">{full}</blockquote></details>}
    <details className="source-disclosure"><summary>بيانات الشرح</summary><p dir="auto">{explanation.reference}</p><p>معرّف المصدر: <bdi>{explanation.sourceId}</bdi></p></details>
  </details>;
}
