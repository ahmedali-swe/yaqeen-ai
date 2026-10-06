import type { Metadata } from "next";
import { AnalysisResults } from "@/components/analysis-results";

export const metadata: Metadata = { title: "نتائج التحليل", robots: { index: false, follow: false } };

export default function AnalysisPage() {
  return <main id="main" className="shell analysis-page">
    <div className="analysis-heading"><h1>نتائج التحليل</h1></div>
    <AnalysisResults />
  </main>;
}
