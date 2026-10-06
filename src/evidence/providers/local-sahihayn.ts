import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import manifest from "../../../data/hadith/manifest.json";
import { keywords, normalizeForSearch } from "../matching";
import { SahihaynRecordSchema, SAHIHAYN_DATASET, SAHIHAYN_REVISION, type SahihaynRecord } from "../sahihayn-schema";
import { EvidenceRetrievalError, type EvidenceCandidate, type EvidenceProvider } from "../types";

type IndexedRecord = { record: SahihaynRecord; normalized: string; terms: Set<string> };
const numberOrder = new Intl.Collator("en", { numeric: true });

async function readBundledCorpus(): Promise<SahihaynRecord[]> {
  try {
    const files = await Promise.all(manifest.files.map(async (file) => {
      const raw = await readFile(resolve(process.cwd(), "data/hadith", file.file), "utf8");
      if (Buffer.byteLength(raw) > 15 * 1024 * 1024 || createHash("sha256").update(raw).digest("hex") !== file.normalizedSha256) throw new Error("Corpus integrity failure");
      const records = z.array(SahihaynRecordSchema).length(file.records).parse(JSON.parse(raw));
      if (records.some((record) => record.collection !== file.collection)) throw new Error("Corpus collection mismatch");
      return records;
    }));
    return files.flat();
  } catch { throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE"); }
}

let bundledCorpus: Promise<SahihaynRecord[]> | undefined;
function loadBundledCorpus(): Promise<SahihaynRecord[]> {
  bundledCorpus ??= readBundledCorpus().catch((error) => { bundledCorpus = undefined; throw error; });
  return bundledCorpus;
}

export async function checkSahihaynCorpus(): Promise<void> { await loadBundledCorpus(); }

/** Verify caller-supplied evidence against read-only, checksum-checked source records. */
export async function authenticateSahihaynEvidence(items: readonly EvidenceCandidate[]): Promise<EvidenceCandidate[] | null> {
  if (!items.length || items.some((item) => !/^sahihayn-(bukhari|muslim)-/.test(item.id))) return null;
  const corpus = await loadBundledCorpus();
  const authenticated: EvidenceCandidate[] = [];
  for (const item of items) {
    const record = corpus.find((entry) => entry.id === item.id);
    if (!record || item.sourceType !== "HADITH" || item.exactText !== record.arabicText || item.reference !== record.reference || item.canonicalUrl !== record.sourceUrl || item.sourceName !== record.collectionArabic) return null;
    // Ignore unauthenticated caller metadata. Only stored fields reach the model.
    authenticated.push({ ...item, title: `${record.collectionArabic} — ${record.hadithNumber}`, metadata: {
      ...record.metadata, collection: record.collection, collectionArabic: record.collectionArabic,
      hadithNumber: record.hadithNumber, chapter: record.chapter, provider: "local-sahihayn",
      retrievalRole: "LOCAL_PRIMARY", dataset: SAHIHAYN_DATASET, datasetRevision: SAHIHAYN_REVISION, format: "plain-text",
    } });
  }
  return authenticated;
}

export function localHadithSearchText(text: string): string {
  return /[«“"]([^»”"]+)[»”"]/u.exec(text)?.[1] ?? text;
}

function score(query: string, terms: string[], entry: IndexedRecord): { score: number; method: string } {
  if (query === entry.normalized) return { score: 1, method: "normalized-exact" };
  if (query.length >= 10 && ` ${entry.normalized} `.includes(` ${query} `)) return { score: 0.98, method: "phrase-containment" };
  const overlap = terms.filter((term) => entry.terms.has(term)).length;
  const ratio = overlap / terms.length;
  if (overlap >= 2 && ratio >= 0.8) return { score: 0.85 + 0.1 * ratio, method: "strong-token-overlap" };
  if (overlap >= 3 && ratio >= 0.6) return { score: 0.5 + 0.2 * ratio, method: "lexical-overlap" };
  return { score: 0, method: "none" };
}

/** A lazy, per-process lexical index. Source strings are never normalized in place. */
export function createLocalSahihaynProvider(loadRecords: () => Promise<readonly SahihaynRecord[]> = loadBundledCorpus): EvidenceProvider {
  let index: Promise<IndexedRecord[]> | undefined;
  return {
    async retrieve(claim, signal) {
      if (signal.aborted) throw new EvidenceRetrievalError("EVIDENCE_TIMEOUT");
      const text = localHadithSearchText(claim.text);
      if (!/[\u0621-\u064a]/u.test(text) || (claim.claimType === "INTERPRETATION" && text === claim.text)) return [];
      const query = normalizeForSearch(text), terms = keywords(text);
      if (terms.length < 2) return [];
      index ??= loadRecords().then((rows) => rows.map((raw) => {
        const record = SahihaynRecordSchema.parse(raw);
        return { record, normalized: normalizeForSearch(record.arabicText), terms: new Set(keywords(record.arabicText)) };
      })).catch(() => { index = undefined; throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE"); });
      const entries = await index;
      if (signal.aborted) throw new EvidenceRetrievalError("EVIDENCE_TIMEOUT");
      return entries.map((entry) => ({ entry, match: score(query, terms, entry) }))
        .filter(({ match }) => match.score > 0)
        .sort((a, b) => b.match.score - a.match.score || a.entry.record.collection.localeCompare(b.entry.record.collection) || numberOrder.compare(a.entry.record.hadithNumber, b.entry.record.hadithNumber))
        .slice(0, 5).map(({ entry: { record }, match }): EvidenceCandidate => ({
          id: record.id, sourceType: "HADITH", title: `${record.collectionArabic} — ${record.hadithNumber}`,
          exactText: record.arabicText, reference: record.reference, canonicalUrl: record.sourceUrl,
          sourceName: record.collectionArabic, relevanceScore: match.score,
          metadata: { ...record.metadata, collection: record.collection, collectionArabic: record.collectionArabic,
            hadithNumber: record.hadithNumber, chapter: record.chapter, provider: "local-sahihayn", retrievalRole: "LOCAL_PRIMARY",
            dataset: SAHIHAYN_DATASET, datasetRevision: SAHIHAYN_REVISION, format: "plain-text", matchMethod: match.method },
        }));
    },
  };
}

export const localSahihaynProvider = createLocalSahihaynProvider();
