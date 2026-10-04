import { BookOpen, GitBranch, ListChecks, Replace, Sparkles } from "lucide-react";

const sections = [
  { id: "claims", number: "٠١", title: "الادعاءات المستخرجة", icon: ListChecks, empty: "لا توجد ادعاءات مستخرجة بعد", detail: "ستظهر هنا الادعاءات المحددة من المحتوى عند تفعيل التحليل." },
  { id: "evidence", number: "٠٢", title: "المصدر والدليل", icon: BookOpen, empty: "لم تُربط أي أدلة بعد", detail: "مكان النص الأصلي ومرجعه وسياقه، من المصادر المعتمدة فقط." },
  { id: "trail", number: "٠٣", title: "مسار الدليل", icon: GitBranch, empty: "لا يوجد مسار دليل بعد", detail: "سيُعرض هنا تسلسل انتقال الدليل إلى المحتوى المنشور." },
  { id: "meaning", number: "٠٤", title: "تحوّل المعنى", icon: Replace, empty: "لم يُحلّل تحوّل المعنى بعد", detail: "مكان توضيح التغيّر بين الدليل الأصلي والصياغة المنشورة." },
  { id: "patch", number: "٠٥", title: "تصحيح يقين", icon: Sparkles, empty: "لا يوجد تصحيح مقترح بعد", detail: "سيظهر هنا تصحيح يحفظ الدليل والسياق بعد التحليل والمراجعة." },
];

export function AnalysisEmptyStates() {
  return <div className="results-grid">{sections.map((section) => <section className={`result-card ${section.id === "patch" ? "patch-result" : ""}`} key={section.id} aria-labelledby={`${section.id}-title`}>
    <div className="result-heading"><h2 id={`${section.id}-title`}>{section.title}</h2><span>{section.number}</span></div>
    <div className="empty-state"><span className="empty-icon"><section.icon size={26} strokeWidth={1.4} aria-hidden="true" /></span><h3>{section.empty}</h3><p>{section.detail}</p></div>
  </section>)}</div>;
}
