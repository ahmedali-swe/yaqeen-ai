import "server-only";
import { z } from "zod";
import { convert } from "html-to-text";
import type { ExtractedClaim } from "@/domain/claim-extraction";
import { readBoundedBody } from "@/lib/read-bounded-body";
import { EvidenceRetrievalError, type EvidenceCandidate, type EvidenceProvider } from "../types";
import { keywords, lexicalScore, normalizeForSearch } from "../matching";

const BASE = "https://api.quranpedia.net/v1";
const positiveInt = z.number().int().positive();
const surahNumber = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(positiveInt.max(114));
const ayahSchema = z.object({ id: positiveInt, surah: surahNumber, number: positiveInt.max(286), text: z.string().min(1).max(20_000), page_number: positiveInt });
const searchSchema = z.object({ items: z.array(z.object({ id: positiveInt, name: z.string().min(1).max(1000), ayahs: z.string().max(20_000) })).max(15) });
const tafsirSchema = z.object({
  book: z.object({ id: z.literal(1), name: z.string().min(1), author: z.object({ ar_name: z.string().min(1) }), edition: z.string().nullish(), publish_year: z.union([z.string(), z.number()]).nullish() }),
  content: z.array(z.object({ text: z.string().min(1).max(100_000), part: z.union([z.string(), z.number()]).nullable(), page: z.union([z.string(), z.number()]).nullable(), ayahs: z.string().min(1) })).max(20),
});

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, { signal, cache: "no-store", redirect: "error", headers: { Accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new EvidenceRetrievalError("EVIDENCE_UNAVAILABLE");
  if (!response.headers.get("content-type")?.includes("application/json")) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
  const text = await readBoundedBody(response.body, 512 * 1024);
  if (text === null) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
  try { return JSON.parse(text); } catch { throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE"); }
}

type Locator = { surah: number; ayah: number };
function parseLocator(value: string): Locator | null {
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const surah = Number(match[1]), ayah = Number(match[2]);
  return surah >= 1 && surah <= 114 && ayah >= 1 && ayah <= 286 ? { surah, ayah } : null;
}
export function explicitQuranReference(claim: ExtractedClaim): Locator | null {
  const text = `${claim.sourceMentioned ?? ""} ${claim.text}`.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  if (!/(?:قر[اآ]ن|سورة|surah|qur'?an|tafsir|تفسير)/i.test(text)) return null;
  const match = /(?:^|[^\d])(\d{1,3})\s*[:：]\s*(\d{1,3})(?!\d)/.exec(text);
  return match ? parseLocator(`${match[1]}:${match[2]}`) : null;
}

export const quranpediaProvider: EvidenceProvider = {
  async retrieve(claim, signal) {
    const explicit = explicitQuranReference(claim);
    const locators: Locator[] = [];
    if (explicit) locators.push(explicit);
    else {
      // The JSON API searches topics, not verse text. Topic labels are only
      // discovery hints; each fetched verse still has to pass lexical matching.
      const terms = keywords(claim.text).filter((word) => /[\u0621-\u064a]/.test(word)).slice(0, 2);
      for (const term of terms) {
        const response = await getJson(`/search/${encodeURIComponent(term)}/topics`, signal);
        const parsed = searchSchema.safeParse(response);
        if (!parsed.success) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
        for (const topic of parsed.data.items) {
          const query = normalizeForSearch(claim.text), name = normalizeForSearch(topic.name);
          if (!query.includes(name) && lexicalScore(query, name) === 0) continue;
          for (const reference of topic.ayahs.split(",")) {
            const locator = parseLocator(reference);
            if (locator && !locators.some((item) => item.surah === locator.surah && item.ayah === locator.ayah)) locators.push(locator);
            if (locators.length >= 4) break;
          }
          if (locators.length >= 4) break;
        }
        if (locators.length >= 4) break;
      }
    }
    const evidence: EvidenceCandidate[] = [];
    for (const locator of locators.slice(0, 4)) {
      const endpoint = `/mushafs/1/${locator.surah}/${locator.ayah}`;
      const response = await getJson(endpoint, signal);
      if (response === null) continue;
      const parsed = ayahSchema.safeParse(response);
      if (!parsed.success || parsed.data.surah !== locator.surah || parsed.data.number !== locator.ayah) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
      const ayah = parsed.data;
      const score = explicit ? 1 : lexicalScore(claim.text, ayah.text);
      if (!score) continue;
      const reference = `${ayah.surah}:${ayah.number}`;
      const canonicalUrl = `https://quranpedia.net/surah/1/${ayah.surah}?ayah_id=${ayah.id}`;
      evidence.push({ id: `quranpedia-hafs-${reference}`, sourceType: "QURAN", title: `القرآن الكريم — ${reference}`, exactText: ayah.text, reference, canonicalUrl, sourceName: "الموسوعة القرآنية — Quranpedia", relevanceScore: score,
        metadata: { provider: "quranpedia", language: "ar", mushafId: 1, mushaf: "حفص", surah: ayah.surah, ayah: ayah.number, ayahId: ayah.id, page: ayah.page_number, apiUrl: `${BASE}${endpoint}`, retrievedAt: new Date().toISOString(), matchMethod: explicit ? "explicit-reference" : "topic-discovery-and-lexical-overlap" } });
      // One documented tafsir book, only for an explicitly cited interpretation.
      // No interpretation or source reference is invented to fill a gap.
      if (explicit && (claim.claimType === "INTERPRETATION" || /تفسير|tafsir/i.test(claim.sourceMentioned ?? ""))) {
        const path = `/ayah/${ayah.surah}/${ayah.number}/book/1`;
        const raw = await getJson(path, signal);
        if (raw === null) continue;
        const tafsir = tafsirSchema.safeParse(raw);
        if (!tafsir.success) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
        for (const [index, passage] of tafsir.data.content.entries()) {
          if (!passage.ayahs.split(",").map((id) => id.trim()).includes(String(ayah.id))) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
          const displayText = convert(passage.text, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }, { selector: "img", format: "skip" }] });
          evidence.push({ id: `quranpedia-tafsir-1-${reference}-${index}`, sourceType: "TAFSIR", title: tafsir.data.book.name, exactText: passage.text, reference: `${reference} — ${tafsir.data.book.name}، ${passage.part ?? "—"}/${passage.page ?? "—"}`, canonicalUrl: `https://quranpedia.net/embed?surah=${ayah.surah}&ayah=${ayah.number}&type=tafsir&book=1`, sourceName: "الموسوعة القرآنية — Quranpedia", relevanceScore: 0.95,
            metadata: { provider: "quranpedia", language: "ar", bookId: 1, author: tafsir.data.book.author.ar_name, edition: tafsir.data.book.edition || null, publishYear: tafsir.data.book.publish_year ?? null, part: passage.part, page: passage.page, linkedAyahIds: passage.ayahs, apiUrl: `${BASE}${path}`, retrievedAt: new Date().toISOString(), format: "source-html", displayText, matchMethod: "explicit-reference-context" } });
        }
      }
    }
    return evidence;
  },
};
