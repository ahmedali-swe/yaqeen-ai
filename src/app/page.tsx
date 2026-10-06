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
        <p className="hero-description">يتحقق يقين من أن المعنى المنشور لا يتجاوز دليله، ويكشف موضع تغيّر المعنى قبل النشر.</p>
        <div className="hero-actions"><a href="#input" className="primary-button">حلّل محتوى الآن <ArrowDown size={17} aria-hidden="true" /></a><a href="#approach" className="hero-link">كيف يعمل يقين؟</a></div>
      </div>
      <div className="evidence-art" aria-hidden="true">
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <span className="art-caption">المعنى متصل بأصله</span>
        <div className="art-line" />
        <div className="art-node node-source"><BookOpen size={23} /><span>الدليل الأصلي</span><small>النص · المصدر · السياق</small></div>
        <div className="art-center"><ArrowDown size={20} strokeWidth={1.5} /><span>انتقال المعنى</span><ArrowDown size={20} strokeWidth={1.5} /></div>
        <div className="art-node node-content"><Quote size={23} /><span>المحتوى المنشور</span><small>الصياغة · النقل · المعنى</small></div>
        <span className="art-note">كل خطوة لها مرجع.</span>
      </div>
    </section>
    <section className="shell input-section" aria-label="ابدأ بإضافة المحتوى"><ContentInput /></section>
    <section className="approach shell" id="approach" aria-labelledby="approach-title">
      <div className="section-heading"><div><span className="eyebrow">منهج يقين</span><h2 id="approach-title">من العبارة إلى الدليل،<br />ثم إلى أمانة المعنى.</h2></div><p>ثلاث خطوات مترابطة لفهم ما يدعمه الدليل<br />وما أضافته الصياغة المنشورة.</p></div>
      <div className="steps-grid">{steps.map((step) => <article key={step.number} className="step-card"><div className="step-top"><step.icon size={25} strokeWidth={1.5} aria-hidden="true" /><span>{step.number}</span></div><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
      <section className="patch-preview" aria-labelledby="patch-preview-title"><div className="patch-preview-heading"><Sparkles size={23} strokeWidth={1.5} aria-hidden="true" /><h3 id="patch-preview-title">تصحيح يقين</h3><span className="status-pill">مثال توضيحي</span></div><div className="patch-preview-comparison"><div><h4>قبل</h4><p>هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول.</p></div><div><h4>بعد</h4><p>هذا الحديث يعني أن الأعمال بالنيات.</p></div></div><p className="evidence-help">أقل تعديل ممكن لإعادة العبارة إلى حدود الدليل. كل اقتراح مرتبط بالأدلة المتاحة ويُعرض للمراجعة.</p></section>
    </section>
  </main>;
}
