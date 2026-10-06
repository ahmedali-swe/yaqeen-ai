import type { ReadonlyRelationInput, RelationAnalysis } from "@/domain/evidence-reasoning";
import { explicitContextEvidenceId } from "@/domain/evidence-reasoning";
import type { EvidenceCandidate } from "@/evidence/types";
import type { EvidenceExplanation } from "@/evidence/explanations/types";
import { keywords, normalizeForSearch } from "@/evidence/matching";
import { resolveEvidenceAnchor } from "@/domain/claim-context";

export const MAX_EXPLANATION_CHARACTERS = 3_200;
export const MAX_EXPLANATION_SEGMENTS = 4;
export const MAX_SURROUNDING_CHARACTERS = 1_200;

/** Internal control flow, never a provider error or a public technical code. */
export class GroundingBudgetError extends Error {
  constructor() { super("Required grounding cannot safely fit"); this.name = "GroundingBudgetError"; }
}

export function strongestEvidence(input: ReadonlyRelationInput, requiredId?: string | null) {
  const id = requiredId ?? explicitContextEvidenceId(input);
  // Stable ties retain the adapter's existing ranking (e.g. Sahihayn uses
  // collection + numeric hadith number, rather than lexical ID ordering).
  const selected = id ? input.evidence.find(item => item.id === id) : [...input.evidence].sort((a, b) => b.relevanceScore - a.relevanceScore)[0];
  if (!selected) throw new GroundingBudgetError();
  return selected;
}

/** Original spans, including whitespace and punctuation. Never an AI summary. */
export function explanationSegments(text: string) {
  return [...text.matchAll(/[^.!?؟\r\n]+(?:[.!?؟]+[ \t\r\n]*|(?:\r?\n)+|$)|[.!?؟\r\n]+/gu)]
    .map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }))
    .filter(segment => segment.text.trim());
}

export function selectExplanation(explanation: Readonly<EvidenceExplanation>, claim: string, hadith: string, unsupported?: string | null) {
  const text = explanation.exactExplanation;
  const base = { evidenceId: explanation.evidenceId, provider: explanation.provider, sourceId: explanation.sourceId, reference: explanation.reference };
  if (text.length <= MAX_EXPLANATION_CHARACTERS) return { ...base, selection: "FULL" as const, segments: [{ text, start: 0, end: text.length }] };
  const claimTerms = keywords(claim), excessTerms = keywords(unsupported ?? ""), hadithTerms = keywords(hadith);
  const segments = explanationSegments(text).map((segment, index) => {
    const terms = new Set(keywords(segment.text));
    const overlap = (query: string[]) => query.filter(term => terms.has(term)).length;
    return { ...segment, index, score: 5 * overlap(claimTerms) + 8 * overlap(excessTerms) + 2 * overlap(hadithTerms) };
  });
  const ranked = [...segments].filter(segment => segment.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  if (!ranked.length || ranked[0].text.length > MAX_EXPLANATION_CHARACTERS) throw new GroundingBudgetError();
  const selected = new Set(ranked.slice(0, MAX_EXPLANATION_SEGMENTS).map(segment => segment.index));
  // Do not discard an explicit qualification of a selected/relevant passage.
  // If these necessary spans cannot fit, abstain rather than silently removing it.
  const qualification = /(?:لكن|إلا|ليس|لا يعني|لا يلزم|لا يدل|لا يشترط|بشرط|إنما|فقط|على أن|however|unless|only|does not)/iu;
  const required = new Set<number>([ranked[0].index]);
  for (const segment of segments) {
    if (qualification.test(segment.text) && (segment.score > 0 || selected.has(segment.index - 1))) {
      required.add(segment.index); selected.add(segment.index);
    }
  }
  if (required.size > MAX_EXPLANATION_SEGMENTS) throw new GroundingBudgetError();
  const ordered = [...selected].sort((a, b) => a - b);
  let characters = ordered.reduce((sum, index) => sum + segments[index].text.length, 0);
  for (const segment of [...ranked].reverse()) {
    if (ordered.length <= MAX_EXPLANATION_SEGMENTS && characters <= MAX_EXPLANATION_CHARACTERS) break;
    if (required.has(segment.index)) continue;
    const position = ordered.indexOf(segment.index);
    if (position >= 0) { ordered.splice(position, 1); characters -= segment.text.length; }
  }
  if (ordered.length > MAX_EXPLANATION_SEGMENTS || characters > MAX_EXPLANATION_CHARACTERS || ordered.length < 2) throw new GroundingBudgetError();
  const exactSegments = ordered.map(index => ({ text: segments[index].text, start: segments[index].start, end: segments[index].end }));
  // Kept as distinct spans: no invented connective text between distant sentences.
  return { ...base, selection: "EXCERPTS" as const, segments: exactSegments };
}

function claimPosition(input: ReadonlyRelationInput): number | null {
  const content = input.originalContent;
  if (!content) return null;
  const { originalStart: start, originalEnd: end, text } = input.claim;
  if (start !== null || end !== null) return start !== null && end !== null && content.slice(start, end) === text && end === start + text.length ? start : null;
  const found = content.indexOf(text);
  return found >= 0 && content.indexOf(text, found + 1) === -1 ? found : null;
}

/** Locate an explicit immediate quotation bridge using existing discourse rules.
 * The generated anchor is grounded in exact source offsets and evidence wording,
 * never adjacency/topic similarity or a previous verdict. */
export function boundedContext(input: ReadonlyRelationInput, evidence: Readonly<EvidenceCandidate>) {
  const content = input.originalContent, start = claimPosition(input);
  if (!content || start === null) return { originalContent: null, contextualAnchor: null };
  const end = start + input.claim.text.length;
  const normalizedEvidence = normalizeForSearch(evidence.exactText);
  const quotes = [...content.matchAll(/[«“"]([^»”"]+)[»”"]/gu)].filter(match => match.index + match[0].length <= start);
  const previous = quotes.at(-1);
  let contextualAnchor: { evidenceId: string; text: string; connector: string; originalStart: number; originalEnd: number } | null = null;
  if (previous && normalizeForSearch(previous[1]).length >= 10 && normalizedEvidence.includes(normalizeForSearch(previous[1]))) {
    const quote = { ...input.claim, id: `${input.claim.id}:quoted-context`, text: previous[0], claimType: "QUOTE" as const, originalStart: previous.index, originalEnd: previous.index + previous[0].length };
    if (resolveEvidenceAnchor({ ...input.claim }, [{ ...input.claim }, quote], content)) {
      contextualAnchor = { evidenceId: evidence.id, text: quote.text, connector: content.slice(quote.originalEnd, start), originalStart: quote.originalStart, originalEnd: quote.originalEnd };
    }
  }
  const requiredStart = contextualAnchor?.originalStart ?? start;
  const requiredLength = end - requiredStart;
  if (requiredLength > MAX_SURROUNDING_CHARACTERS) {
    // The claim is already supplied separately. Keep the anchor/bridge intact.
    if (contextualAnchor && contextualAnchor.text.length + contextualAnchor.connector.length > MAX_SURROUNDING_CHARACTERS) throw new GroundingBudgetError();
    return { originalContent: null, contextualAnchor };
  }
  const padding = Math.min(120, Math.floor((MAX_SURROUNDING_CHARACTERS - requiredLength) / 2));
  return { originalContent: content.slice(Math.max(0, requiredStart - padding), Math.min(content.length, end + padding)), contextualAnchor };
}

export function compactClaim(claim: ReadonlyRelationInput["claim"]) {
  return { id: claim.id, text: claim.text, claimType: claim.claimType, attributedTo: claim.attributedTo, sourceMentioned: claim.sourceMentioned };
}

export function groundingPayload(input: ReadonlyRelationInput, analysis?: Readonly<RelationAnalysis>) {
  const strongest = strongestEvidence(input, analysis?.strongestEvidenceId);
  const explanation = input.approvedExplanations?.find(item => item.evidenceId === strongest.id);
  return { claim: compactClaim(input.claim),
    evidence: [{ id: strongest.id, sourceType: strongest.sourceType, reference: strongest.reference, collection: strongest.metadata.collection ?? strongest.sourceName, exactText: strongest.exactText,
      ...(typeof strongest.metadata.narrator === "string" ? { narrator: strongest.metadata.narrator } : {}),
      ...(strongest.metadata.retrievalIncomplete === true ? { incomplete: true } : {}) }],
    approvedExplanations: explanation ? [selectExplanation(explanation, input.claim.text, strongest.exactText, analysis?.unsupportedPart)] : [],
    ...boundedContext(input, strongest),
  };
}
