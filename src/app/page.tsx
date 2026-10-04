import { ArrowDown, BookOpen, GitBranch, Quote, Sparkles } from "lucide-react";
import { ContentInput } from "@/components/content-input";

const steps = [
  { number: "٠١", icon: Quote, title: "نفهم الادعاء", description: "تحديد ما يقوله المحتوى، وفصل الادعاء عن الشرح والرأي." },
  { number: "٠٢", icon: BookOpen, title: "نعود إلى الدليل", description: "ربط كل ادعاء بمصدر معتمد، مع حفظ النص الأصلي وسياقه." },
  { number: "٠٣", icon: GitBranch, title: "نتتبّع المعنى", description: "تتبّع انتقال المعنى من الدليل إلى الصياغة المنشورة." },
];

export default function HomePage() {
  return <main id="main">
    <section className="hero shell" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="hero-tag"><span /> من المحتوى إلى الدليل</div>
        <h1 id="hero-title">للمعنى أمانة.<br /><span>وللدليل مسار.</span></h1>
        <p className="hero-description">يقين، منصة للتحقق من المحتوى الإسلامي؛ تبدأ من أصل الدليل، وتتتبّع كيف يتغيّر المعنى حتى يصل إلى ما نقرأه ونشاركه.</p>
        <a href="#input" className="hero-link">ابدأ من نص أو صورة <ArrowDown size={17} aria-hidden="true" /></a>
      </div>
      <div className="evidence-art" aria-hidden="true">
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <span className="art-caption">المعنى متصل بأصله</span>
        <div className="art-line" />
        <div className="art-node node-source"><BookOpen size={23} /><span>أصل الدليل</span><small>النص · المصدر · السياق</small></div>
        <div className="art-center"><GitBranch size={32} strokeWidth={1.3} /></div>
        <div className="art-node node-content"><Quote size={23} /><span>المحتوى المنشور</span><small>الصياغة · النقل · المعنى</small></div>
        <span className="art-note">كل خطوة، لها مرجع.</span>
      </div>
    </section>
    <section className="shell input-section" aria-label="ابدأ بإضافة المحتوى"><ContentInput /></section>
    <section className="approach shell" id="approach" aria-labelledby="approach-title">
      <div className="section-heading"><div><span className="eyebrow">منهج يقين</span><h2 id="approach-title">لا يكفي أن نعرف النتيجة.<br />نحتاج أن نفهم الطريق إليها.</h2></div><p>منهج العمل المخطّط للمنصة.<br />محرك التحقق لم يُفعّل بعد.</p></div>
      <div className="steps-grid">{steps.map((step) => <article key={step.number} className="step-card"><div className="step-top"><step.icon size={25} strokeWidth={1.5} aria-hidden="true" /><span>{step.number}</span></div><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
      <div className="patch-note"><Sparkles size={23} strokeWidth={1.5} aria-hidden="true" /><div><h3>تصحيح يقين <span lang="en" dir="ltr">Yaqeen Patch</span></h3><p>لاحقًا: صياغة تصحيح تحفظ الدليل والسياق، وتوضح أين تغيّر المعنى.</p></div><span className="status-pill">قيد التطوير</span></div>
    </section>
  </main>;
}
