"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlignRight, ArrowLeft, ImagePlus, Info, Upload, X } from "lucide-react";
import { MAX_TEXT_LENGTH, validateImage, validateText } from "@/lib/input";

export function ContentInput() {
  const router = useRouter();
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = mode === "text" ? validateText(text) : file ? validateImage(file) : "اختر صورة أولًا.";
    setError(message);
    if (!message) router.push("/analysis");
  }

  return <form onSubmit={submit} className="input-card" id="input" aria-label="إدخال المحتوى" noValidate>
    <div className="input-top">
      <div><span className="eyebrow">البداية من هنا</span><h2>ما المحتوى الذي تريد التحقق منه؟</h2></div>
      <fieldset className="mode-switch">
        <legend className="sr-only">نوع المحتوى</legend>
        {(["text", "image"] as const).map((item) => <label key={item} className={mode === item ? "active" : ""}>
          <input className="sr-only" type="radio" name="input-mode" value={item} checked={mode === item} onChange={() => { setMode(item); setError(null); }} />
          {item === "text" ? <AlignRight size={17} aria-hidden="true" /> : <ImagePlus size={17} aria-hidden="true" />}
          {item === "text" ? "نص" : "صورة"}
        </label>)}
      </fieldset>
    </div>
    {mode === "text" ? <div className="text-input-wrap">
      <label htmlFor="content-text" className="sr-only">النص المراد تحليله</label>
      <textarea id="content-text" value={text} maxLength={MAX_TEXT_LENGTH} onChange={(event) => { setText(event.target.value); setError(null); }} placeholder="ألصق النص هنا… مقولة، منشور، أو محتوى إسلامي ترغب في تتبّع دليله." aria-invalid={Boolean(error)} aria-describedby={error ? "input-error input-notice" : "input-notice"} />
      <span className="character-count">{text.length.toLocaleString("ar-SA")} / ١٠٬٠٠٠ حرف</span>
    </div> : <div className="image-input-wrap">
      <Upload size={29} strokeWidth={1.4} aria-hidden="true" />
      <label className="upload-label" htmlFor="content-image">اختر صورة من جهازك</label>
      <p>PNG، JPG أو WebP · بحد أقصى ٥ ميغابايت</p>
      <input ref={fileInput} id="content-image" type="file" accept="image/png,image/jpeg,image/webp" aria-invalid={Boolean(error)} aria-describedby={error ? "input-error input-notice" : "input-notice"} onChange={(event) => {
        const selected = event.target.files?.[0] ?? null;
        const message = selected ? validateImage(selected) : null;
        setError(message); setFile(message ? null : selected);
        if (message && fileInput.current) fileInput.current.value = "";
      }} />
      {file && <div className="selected-file"><bdi>{file.name}</bdi><button type="button" aria-label="إزالة الصورة" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={16} /></button></div>}
    </div>}
    {error && <p id="input-error" className="input-error" role="alert">{error}</p>}
    <div className="input-bottom">
      <p id="input-notice"><Info size={16} aria-hidden="true" /><span>التحليل قيد التطوير. الزر يفتح صفحة نتائج فارغة؛ لا يُرسل المحتوى ولا يُحفظ.</span></p>
      <button type="submit" className="primary-button">تحليل المحتوى <ArrowLeft size={18} aria-hidden="true" /></button>
    </div>
  </form>;
}
