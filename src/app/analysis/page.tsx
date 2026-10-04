import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleDashed, Info } from "lucide-react";
import { AnalysisEmptyStates } from "@/components/analysis-empty-states";

export const metadata: Metadata = { title: "نتائج التحليل", robots: { index: false, follow: false } };

export default function AnalysisPage() {
  return <main id="main" className="shell analysis-page">
    <Link href="/#input" className="back-link"><ArrowRight size={17} aria-hidden="true" /> العودة إلى إدخال المحتوى</Link>
    <div className="analysis-heading"><div><span className="eyebrow">من المحتوى إلى الدليل</span><h1>نتائج التحليل</h1><p>كل ادعاء، بدليله. وكل معنى، بسياقه.</p></div><span className="status-pill"><CircleDashed size={15} aria-hidden="true" /> لم يبدأ التحليل</span></div>
    <div className="analysis-notice" role="status"><Info size={21} aria-hidden="true" /><p><strong>التحقق الآلي قيد التطوير.</strong> هذه صفحة نتائج فارغة؛ لم يُحلّل محتوى، ولم يُحفظ تقرير أو يُصدر حكم تحقق.</p></div>
    <AnalysisEmptyStates />
  </main>;
}
