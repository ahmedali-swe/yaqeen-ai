"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" className="shell simple-state"><h1>تعذّر عرض الصفحة</h1><p>حاول مرة أخرى بعد قليل.</p><button className="primary-button" onClick={reset}>إعادة المحاولة</button></main>;
}
