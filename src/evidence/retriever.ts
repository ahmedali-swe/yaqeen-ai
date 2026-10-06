import "server-only";
import { ExtractedClaimSchema, type ExtractedClaim } from "@/domain/claim-extraction";
import { EvidenceCandidateSchema, EvidenceRetrievalError, type EvidenceCandidate, type EvidenceProvider, type EvidenceResult } from "./types";
import { dorarProvider, dorarQuery, dorarSearchText } from "./providers/dorar";
import { explicitQuranReference, quranpediaProvider } from "./providers/quranpedia";
import { localSahihaynProvider } from "./providers/local-sahihayn";
import { parseEnv } from "@/lib/env";
import { keywords } from "./matching";

export const RETRIEVAL_TIMEOUT_MS = 12_000;
export function rankEvidence(candidates: EvidenceCandidate[]): EvidenceCandidate[] {
  const seen = new Set<string>();
  return candidates.map((candidate) => EvidenceCandidateSchema.parse(candidate))
    .filter((candidate) => candidate.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.id.localeCompare(b.id))
    .filter((candidate) => {
      const key = `${candidate.canonicalUrl}|${candidate.reference}|${candidate.exactText}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 8);
}

async function runProvider(provider: EvidenceProvider, claim: ExtractedClaim, signal: AbortSignal): Promise<EvidenceCandidate[]> {
  let onAbort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new EvidenceRetrievalError("EVIDENCE_TIMEOUT"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    const candidates = await Promise.race([provider.retrieve(claim, signal), interrupted]);
    return candidates.map((item) => EvidenceCandidateSchema.parse(item));
  } finally { signal.removeEventListener("abort", onAbort); }
}

export async function retrieveEvidence(claim: ExtractedClaim, providers?: EvidenceProvider[], parentSignal?: AbortSignal): Promise<EvidenceResult> {
  const validated = ExtractedClaimSchema.parse(claim);
  if (!validated.isVerifiable) return { evidence: [] };
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  if (parentSignal?.aborted) abort();
  const timer = setTimeout(abort, RETRIEVAL_TIMEOUT_MS);
  try {
    if (providers === undefined && !explicitQuranReference(validated)) {
      const local = await runProvider(localSahihaynProvider, validated, controller.signal);
      const enabled = parseEnv(process.env).DORAR_ENABLED === "true";
      if (local.length) return { evidence: local, retrieval: { hadithCorpus: "SAHIHAYN", hadith: "LOCAL_PRIMARY", dorar: enabled ? "NOT_REQUESTED" : "DISABLED", quranpedia: "NOT_REQUESTED" } };
      const searchText = dorarSearchText(validated);
      const attemptDorar = enabled && searchText !== null && keywords(dorarQuery(searchText)).length >= 2;
      // A completed primary-corpus miss stays usable even if optional live sources
      // fail. Disclose their status; never turn an outage into an undisclosed miss.
      const [dorar, quran] = await Promise.allSettled([
        attemptDorar ? runProvider(dorarProvider, validated, controller.signal) : Promise.resolve([]),
        runProvider(quranpediaProvider, validated, controller.signal),
      ]);
      if (parentSignal?.aborted) throw new EvidenceRetrievalError("EVIDENCE_TIMEOUT");
      const hadith = dorar.status === "fulfilled" ? dorar.value.map((item) => ({ ...item, metadata: { ...item.metadata, retrievalRole: "DORAR_CROSSCHECK" } })) : [];
      const candidates = [...hadith, ...(quran.status === "fulfilled" ? quran.value : [])];
      const incomplete = dorar.status === "rejected" || quran.status === "rejected";
      return { evidence: rankEvidence(candidates).map((item) => incomplete ? { ...item, metadata: { ...item.metadata, retrievalIncomplete: true } } : item),
        retrieval: { hadithCorpus: "SAHIHAYN", hadith: hadith.length ? "DORAR_CROSSCHECK" : "NO_LOCAL_MATCH",
          dorar: !enabled ? "DISABLED" : !attemptDorar ? "NOT_REQUESTED" : dorar.status === "fulfilled" ? "AVAILABLE" : "UNAVAILABLE",
          quranpedia: quran.status === "fulfilled" ? "AVAILABLE" : "UNAVAILABLE" } };
    }
    const results = await Promise.allSettled((providers ?? [quranpediaProvider]).map((provider) => runProvider(provider, validated, controller.signal)));
    if (parentSignal?.aborted) throw new EvidenceRetrievalError("EVIDENCE_TIMEOUT");
    const candidates = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const failures = results.filter((result) => result.status === "rejected");
    if (!candidates.length && failures.length) {
      const error = failures[0].reason;
      if (error instanceof EvidenceRetrievalError) throw error;
      throw new EvidenceRetrievalError("EVIDENCE_UNAVAILABLE");
    }
    // Keep usable evidence when another source is unavailable; disclose that the
    // search was incomplete, never misrepresent an outage as a successful miss.
    const evidence = rankEvidence(candidates);
    return { evidence: failures.length ? evidence.map((item) => ({ ...item, metadata: { ...item.metadata, retrievalIncomplete: true } })) : evidence };
  } finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", abort); controller.abort(); }
}
