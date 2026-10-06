import type { ExtractedClaim } from "@/domain/claim-extraction";
import { keywords, lexicalScore, normalizeForSearch } from "./matching";

const MAX_QUERY_LENGTH = 320;
const arabic = /\p{Script=Arabic}/u;
function quotations(text: string): string[] {
  return [...text.matchAll(/«([^»]+)»|“([^”]+)”|"([^"]+)"/gu)]
    .map((match) => (match[1] ?? match[2] ?? match[3]).trim()).filter((span) => arabic.test(span));
}

/** Exact spans only; long passages become bounded, word-aligned search excerpts. */
function excerpts(text: string): string[] {
  const value = text.trim();
  if (value.length <= MAX_QUERY_LENGTH) return value ? [value] : [];
  const words = [...value.matchAll(/\S+/gu)];
  const result: string[] = [];
  for (let start = 0; start < words.length; start += 8) {
    let end = Math.min(start + 20, words.length);
    while (end > start && words[end - 1].index! + words[end - 1][0].length - words[start].index! > MAX_QUERY_LENGTH) end--;
    if (end > start) result.push(value.slice(words[start].index, words[end - 1].index! + words[end - 1][0].length));
  }
  return result.length ? result : [value.slice(0, MAX_QUERY_LENGTH)];
}
function strongest(spans: string[], claimText: string): string {
  const terms = keywords(claimText);
  const ranked = spans.flatMap(excerpts).map((text, index) => {
    const available = new Set(keywords(text));
    return { text, index, score: lexicalScore(claimText, text), overlap: terms.filter((term) => available.has(term)).length };
  });
  ranked.sort((a, b) => b.score - a.score || b.overlap - a.overlap || a.index - b.index);
  return ranked[0]?.text ?? "";
}

/** A user-initiated search hint, never evidence of Dorar verification. */
export function hadithSearchText({ claimText = "", claimType, displayedText, sourceText }: {
  claimText?: string; claimType?: ExtractedClaim["claimType"]; displayedText: string; sourceText: string;
}): string {
  const normalizedSource = ` ${normalizeForSearch(sourceText)} `;
  const quoted = quotations(claimText);
  if (claimType === "QUOTE" && !quoted.length && arabic.test(claimText)) quoted.push(claimText.trim());
  const matches = quoted.filter((text) => {
    const normalized = normalizeForSearch(text);
    return normalized.length > 0 && normalizedSource.includes(` ${normalized} `);
  });
  if (matches.length) return strongest(matches, claimText);
  // Source quotation delimiters identify matn spans before any isnad fallback.
  const sourceQuotes = quotations(sourceText);
  const spans = sourceQuotes.length ? sourceQuotes : [displayedText].filter((text) => arabic.test(text));
  return strongest(spans.length ? spans : [displayedText], claimText);
}

export function dorarSearchUrl(text: string): string {
  return `https://dorar.net/site/search?q=${encodeURIComponent(text.toWellFormed())}`;
}
