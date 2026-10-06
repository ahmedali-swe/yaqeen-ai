import { keywords, normalizeForSearch } from "../matching";
import type { EvidenceExplanation } from "./types";

function spans(text: string): string[] {
  const quotes = [...text.matchAll(/[«“"]([^»”"]+)[»”"]/gu)].map((match) => match[1]);
  return quotes.length ? quotes : [text];
}
const distinctive = (text: string) => normalizeForSearch(text).length >= 15 && normalizeForSearch(text).split(" ").length >= 3 && keywords(text).length >= 2;
export type ExplanationMatch = { method: EvidenceExplanation["matchMethod"]; rank: number };

/** A tie-breaker only after a defensible text match: contiguous matn words,
 * not topic overlap. Long unique agreement can distinguish narration variants. */
export function contiguousAgreement(source: string, candidate: string): number {
  let best = 0;
  for (const a of spans(source).map(normalizeForSearch)) for (const b of spans(candidate).map(normalizeForSearch)) {
    const left = a.split(" "), right = b.split(" ");
    if (left.length > 1_000 || right.length > 1_000) continue;
    let previous = new Uint16Array(right.length + 1);
    for (const word of left) {
      const next = new Uint16Array(right.length + 1);
      for (let j = 0; j < right.length; j++) if (word === right[j]) { next[j + 1] = previous[j] + 1; best = Math.max(best, next[j + 1]); }
      previous = next;
    }
  }
  return best;
}

/** Match source wording, never subject/topic, grade or collection alone. Exact
 * contiguous phrases dominate; fuzzy matching needs long, near-identical matn. */
export function matchExplanation(source: string, candidate: string, query?: string): ExplanationMatch | null {
  const sourceSpans = [...spans(source), ...(query && ` ${normalizeForSearch(source)} `.includes(` ${normalizeForSearch(query)} `) ? [query] : [])].filter(distinctive);
  const candidateSpans = spans(candidate).filter(distinctive);
  let best: ExplanationMatch | null = null;
  for (const sourceSpan of sourceSpans) for (const candidateSpan of candidateSpans) {
    const a = normalizeForSearch(sourceSpan), b = normalizeForSearch(candidateSpan);
    if (a === b) return { method: "EXACT_TEXT", rank: 3 };
    if (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)) { if (!best || best.rank < 2) best = { method: "PHRASE_CONTAINMENT", rank: 2 }; }
    if (best) continue;
    const aTerms = keywords(a), bTerms = keywords(b), shared = aTerms.filter((term) => bTerms.includes(term)).length;
    // >=8 distinctive shared terms and >=95% overlap in BOTH directions.
    // In particular short quotations never get a fuzzy explanation match.
    if (shared >= 8 && shared / aTerms.length >= .95 && shared / bTerms.length >= .95 && a.split(" ").length >= 12 && b.split(" ").length >= 12) best = { method: "STRONG_LEXICAL_MATCH", rank: 1 };
  }
  return best;
}
