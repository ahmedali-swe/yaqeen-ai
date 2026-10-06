"use client";

import { useClaimAnalysis } from "./claim-analysis-provider";
import { AnalysisEmptyStates } from "./analysis-empty-states";

export function AnalysisResults() {
  const { result, originalContent, report, setReport, hydrated } = useClaimAnalysis();
  if (!hydrated) return <p role="status">جارٍ استعادة جلسة التحليل…</p>;
  return <>
    <p className="analysis-session-note" role="status">{result ? "تقرير مؤقت لهذه الجلسة، يُستعاد عند تحديث الصفحة ولا يُحفظ بصورة دائمة." : "لا توجد نتيجة استخراج في هذه الجلسة. أرسل نصًا من الصفحة الرئيسية."}</p>
    <AnalysisEmptyStates key={JSON.stringify([result, originalContent])} extraction={result} originalContent={originalContent} report={report} onReportChange={setReport} />
  </>;
}
