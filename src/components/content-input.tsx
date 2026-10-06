"use client";
import { TEMPORARY_AI_MESSAGE } from "@/lib/ai-messages";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlignRight, ArrowLeft, Info, LoaderCircle } from "lucide-react";
import { MAX_TEXT_LENGTH, validateText } from "@/lib/input";
import { ClaimExtractionResultSchema } from "@/domain/claim-extraction";
import { useClaimAnalysis } from "./claim-analysis-provider";
import { InlineAlert } from "./inline-alert";

const errorMessages: Record<string, string> = {
  AI_NOT_CONFIGURED: "خدمة استخراج الادعاءات غير مهيّأة حاليًا. حاول لاحقًا.",
  AI_TIMEOUT: TEMPORARY_AI_MESSAGE,
  AI_UNAVAILABLE: TEMPORARY_AI_MESSAGE,
  INVALID_AI_RESPONSE: "تعذّر قراءة نتيجة موثوقة للاستخراج. حاول مرة أخرى.",
  RATE_LIMITED: "الخدمة مشغولة حاليًا. انتظر دقيقة ثم حاول مرة أخرى.",
  INVALID_INPUT: "أضف نصًا من ١٠ إلى ١٠٬٠٠٠ حرف لاستخراج الادعاءات.",
  INPUT_TOO_LARGE: "حجم المحتوى أكبر من المسموح. اختصر النص ثم حاول مرة أخرى.",
};

export function ContentInput() {
  const router = useRouter();
  const { setResult, hydrated } = useClaimAnalysis();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [technicalError, setTechnicalError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (request.current || !hydrated) return;
    const message = validateText(text);
    setError(message);
    setTechnicalError(false);
    if (message) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35_000);
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/analyze/claims", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }), signal: controller.signal, cache: "no-store",
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const code = typeof data === "object" && data !== null && "error" in data && typeof data.error === "object" && data.error !== null && "code" in data.error && typeof data.error.code === "string" ? data.error.code : "AI_UNAVAILABLE";
        setError(errorMessages[code] ?? errorMessages.AI_UNAVAILABLE);
        setTechnicalError(true);
        return;
      }
      const parsed = ClaimExtractionResultSchema.safeParse(data);
      if (!parsed.success) { setError(errorMessages.INVALID_AI_RESPONSE); setTechnicalError(true); return; }
      setResult(parsed.data, text);
      router.push("/analysis");
    } catch {
      setError(controller.signal.aborted ? errorMessages.AI_TIMEOUT : errorMessages.AI_UNAVAILABLE);
      setTechnicalError(true);
    } finally {
      clearTimeout(timeout);
      request.current = null;
      setLoading(false);
    }
  }

  return <form onSubmit={submit} className="input-card" id="input" aria-label="إدخال المحتوى" aria-busy={loading} noValidate>
    <div className="input-top">
      <div><span className="eyebrow">البداية من هنا</span><h2>ما المحتوى الذي تريد التحقق منه؟</h2></div>
      <span className="input-type"><AlignRight size={17} aria-hidden="true" /> نص</span>
    </div>
    <div className="text-input-wrap">
      <label htmlFor="content-text" className="sr-only">النص المراد تحليله</label>
      <textarea id="content-text" disabled={loading} value={text} maxLength={MAX_TEXT_LENGTH} onChange={(event) => { setText(event.target.value); setError(null); }} placeholder="ألصق منشورًا، اقتباسًا، أو محتوى إسلاميًا تريد التحقق من أمانة معناه ودليله." aria-invalid={Boolean(error)} aria-describedby={error ? "input-error input-notice" : "input-notice"} />
      <span className="character-count">{text.length.toLocaleString("ar-SA")} / ١٠٬٠٠٠ حرف</span>
    </div>
    {error && <div id="input-error">{technicalError ? <InlineAlert message={error} onRetry={() => submit()} /> : <p className="input-error" role="alert">{error}</p>}</div>}
    <div className="input-bottom">
      <p id="input-notice"><Info size={16} aria-hidden="true" /><span>يُحلَّل النص عند الطلب، ولا يُحفظ تقرير دائم.</span></p>
      {!technicalError || !error ? <button type="submit" className="primary-button" disabled={loading || !hydrated}>{loading ? <>جارٍ التحليل… <LoaderCircle size={18} aria-hidden="true" /></> : <>ابدأ التحقق <ArrowLeft size={18} aria-hidden="true" /></>}</button> : null}
      {loading && <span role="status" className="sr-only">جارٍ التحليل، يرجى الانتظار.</span>}
    </div>
  </form>;
}
