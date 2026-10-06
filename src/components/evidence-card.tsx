"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Copy, ExternalLink } from "lucide-react";
import type { ExtractedClaim } from "@/domain/claim-extraction";
import { evidenceSourceUrl, type EvidenceCandidate } from "@/evidence/types";
import { normalizeForSearch } from "@/evidence/matching";
import { dorarSearchUrl, hadithSearchText } from "@/evidence/hadith-search";
import type { EvidenceExplanation } from "@/evidence/explanations/types";
import { ApprovedExplanation } from "./approved-explanation";

const sourceLabels = { QURAN: "قرآن", HADITH: "حديث", TAFSIR: "تفسير" };
export function evidenceReferenceLabel(item: EvidenceCandidate): string | null {
  if (item.sourceType === "HADITH" && typeof item.metadata.hadithNumber === "string") return `حديث رقم ${item.metadata.hadithNumber}`;
  if (!item.reference) return null;
  return item.reference.startsWith(item.sourceName) ? item.reference.slice(item.sourceName.length).replace(/^[\s،,—–-]+/u, "") || null : item.reference;
}

/** Display an exact source span, never an LLM summary or silent truncation. */
export function evidenceExcerpt(item: EvidenceCandidate, anchorText?: string): string | null {
  if (item.sourceType !== "HADITH" || item.metadata.format === "source-html" || item.exactText.length < 400) return null;
  const spans = [...item.exactText.matchAll(/[«“"]([^»”"]{20,})[»”"]/gu)].map((match) => match[1]);
  const needle = anchorText ? normalizeForSearch(anchorText).replace(/^[«“"]|[»”"]$/gu, "") : "";
  return spans.find((span) => needle.length >= 8 && normalizeForSearch(span).includes(needle)) ?? spans.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function EvidenceCard({ evidence: item, anchorText, anchorClaimType, explanation }: { evidence: EvidenceCandidate; anchorText?: string; anchorClaimType?: ExtractedClaim["claimType"]; explanation?: EvidenceExplanation }) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reset.current) clearTimeout(reset.current); }, []);
  const excerpt = evidenceExcerpt(item, anchorText), reference = evidenceReferenceLabel(item), url = evidenceSourceUrl(item);
  const displayText = item.metadata.format === "source-html" && typeof item.metadata.displayText === "string" ? item.metadata.displayText : item.exactText;
  const displayedText = excerpt ?? displayText;
  const searchText = item.sourceType === "HADITH" ? hadithSearchText({ claimText: anchorText, claimType: anchorClaimType, displayedText, sourceText: displayText }) : "";
  async function copyHadith() {
    if (copyState === "copying") return;
    if (reset.current) clearTimeout(reset.current);
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(displayedText);
      setCopyState("copied");
      reset.current = setTimeout(() => setCopyState("idle"), 2_500);
    } catch { setCopyState("failed"); }
  }
  return <article className="evidence-item">
    <header className="source-heading"><BookOpen size={20} aria-hidden="true" /><div><h3>{item.sourceName}</h3>{reference && <p className="evidence-reference" dir="auto">{reference}</p>}</div><span className="source-type">{sourceLabels[item.sourceType]}</span></header>
    {excerpt && <p className="evidence-help">مقتطف من الدليل؛ النص الكامل محفوظ أدناه.</p>}
    <blockquote dir="auto">{displayedText}</blockquote>
    {excerpt && <details className="source-disclosure"><summary>عرض النص الكامل والإسناد</summary><blockquote dir="auto">{item.exactText}</blockquote></details>}
    {explanation && explanation.evidenceId === item.id && <ApprovedExplanation explanation={explanation} />}
    <div className="source-footer">
      {item.sourceType === "HADITH" && <div className="hadith-actions" aria-label="التحقق اليدوي من الحديث">
        <button type="button" className="hadith-icon-action" aria-label="نسخ نص الحديث" title="نسخ نص الحديث" disabled={copyState === "copying"} onClick={copyHadith}>{copyState === "copied" ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}</button>
        <a className="hadith-icon-action" href={dorarSearchUrl(searchText)} target="_blank" rel="noopener noreferrer" aria-label="البحث في الدرر السنية" title="البحث في الدرر السنية"><ExternalLink size={17} aria-hidden="true" /></a>
        {copyState === "copied" && <span className="copy-feedback" role="status">تم النسخ</span>}
        {copyState === "failed" && <span className="copy-feedback" role="alert">تعذر النسخ. حاول مرة أخرى.</span>}
      </div>}
      {item.sourceType !== "HADITH" && url && <a href={url} target="_blank" rel="noopener noreferrer">عرض المرجع<ExternalLink size={14} aria-hidden="true" /><span className="sr-only">(يفتح في نافذة جديدة)</span></a>}
      {item.sourceType === "HADITH" && (["narrator", "scholar", "grading"] as const).some((key) => typeof item.metadata[key] === "string" && item.metadata[key]) && <details className="source-disclosure"><summary>بيانات المرجع</summary><dl className="relation-details">{([["narrator", "الراوي"], ["scholar", "المحدث"], ["grading", "حكم المحدث كما ورد في المصدر"]] as const).map(([key, label]) => typeof item.metadata[key] === "string" && item.metadata[key] ? <div key={key}><dt>{label}</dt><dd dir="auto">{item.metadata[key]}</dd></div> : null)}</dl></details>}
    </div>
  </article>;
}
