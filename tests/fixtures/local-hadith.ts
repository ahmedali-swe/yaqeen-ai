// Offline test adapter only. Never imported by application code or used as fallback.
import corpus from "./hadith.json";
import { EvidenceCandidateSchema, type EvidenceProvider } from "../../src/evidence/types";
import { lexicalScore } from "../../src/evidence/matching";

const entries = corpus.map((entry) => EvidenceCandidateSchema.parse(entry));
export const localHadithProvider: EvidenceProvider = {
  async retrieve(claim, signal) {
    signal.throwIfAborted();
    return entries.map((entry) => ({ ...entry, relevanceScore: lexicalScore(claim.text, entry.exactText) }))
      .filter((entry) => entry.relevanceScore > 0);
  },
};
