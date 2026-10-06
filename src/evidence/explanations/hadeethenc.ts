import "server-only";
import { createHash } from "node:crypto";
import { readBoundedBody } from "@/lib/read-bounded-body";
import { hadithSearchText } from "../hadith-search";
import { normalizeForSearch } from "../matching";
import type { EvidenceCandidate, EvidenceResult } from "../types";
import { matchExplanation, contiguousAgreement } from "./matching";
import { HadeethEncDetailSchema, HadeethEncSearchSchema, HADEETHENC_SOURCE_NAME, type EvidenceExplanation, type ExplanationResult } from "./types";

const BASE = "https://hadeethenc.com/api/v1/hadeeths/";
export const HADEETHENC_TIMEOUT_MS = 3_000;
const TTL = 10 * 60_000, LIMIT = 200, BYTE_LIMIT = 4 * 1024 * 1024;
type Entry<T> = { value: T; until: number; bytes: number };
function remember<T>(cache: Map<string, Entry<T>>, key: string, value: T, until: number) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > 256 * 1024) return;
  cache.delete(key); cache.set(key, { value, until, bytes });
  let total = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (cache.size > LIMIT || total > BYTE_LIMIT) {
    const oldest = cache.keys().next().value!; total -= cache.get(oldest)!.bytes; cache.delete(oldest);
  }
}
type Options = { fetcher?: typeof fetch; now?: () => number };
export function createHadeethEncResolver({ fetcher = (...args) => fetch(...args), now = Date.now }: Options = {}) {
  const cache = new Map<string, Entry<ExplanationResult>>();
  const pending = new Map<string, Promise<ExplanationResult>>();
  const responses = new Map<string, Entry<unknown>>();
  const requests = new Map<string, Promise<unknown>>();
  async function json(url: string, signal: AbortSignal): Promise<unknown> {
    const hit = responses.get(url); if (hit && hit.until > now()) return hit.value;
    if (requests.has(url)) return requests.get(url)!;
    const request = (async () => {
      const response = await fetcher(url, { signal, redirect: "error", cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Source unavailable"); }
      const raw = await readBoundedBody(response.body, 2 * 1024 * 1024);
      if (raw === null) throw new Error("Invalid source response");
      if (signal.aborted) throw new Error("Source timeout");
      const value: unknown = JSON.parse(raw);
      return url.includes("/search/") ? HadeethEncSearchSchema.parse(value) : HadeethEncDetailSchema.parse(value);
    })();
    requests.set(url, request);
    try {
      const value = await request;
      remember(responses, url, value, now() + TTL);
      return value;
    } finally { requests.delete(url); }
  }
  async function lookup(item: EvidenceCandidate, hint?: string): Promise<ExplanationResult> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), HADEETHENC_TIMEOUT_MS);
    let abort!: () => void;
    const deadline = new Promise<never>((_, reject) => { abort = () => reject(new Error("Source timeout")); controller.signal.addEventListener("abort", abort, { once: true }); });
    const work = async (): Promise<ExplanationResult> => {
      const plain = item.metadata.format === "source-html" && typeof item.metadata.displayText === "string" ? item.metadata.displayText : item.exactText;
      const query = hadithSearchText({ claimText: hint, claimType: "QUOTE", displayedText: plain, sourceText: plain });
      const normalized = normalizeForSearch(query);
      const candidates = HadeethEncSearchSchema.parse(await json(`${BASE}search/?language=ar&phrase=${encodeURIComponent(normalized)}`, controller.signal));
      const ranked = candidates.flatMap((record) => { const match = matchExplanation(plain, record.hadith_text, query); return match ? [{ record, match, agreement: contiguousAgreement(plain, record.hadith_text) }] : []; }).sort((a, b) => b.match.rank - a.match.rank || b.agreement - a.agreement || a.record.id.localeCompare(b.record.id));
      const tied = ranked[1] && ranked[0].match!.rank === ranked[1].match!.rank && ranked[0].record.id !== ranked[1].record.id;
      // A short shared opening cannot pick between records. Only a substantially
      // longer exact contiguous source passage resolves an otherwise tied match.
      const uniquePassage = tied && ranked[0].agreement >= 12 && ranked[0].agreement >= ranked[1].agreement + 4 && ranked[0].agreement >= ranked[1].agreement * 1.5;
      if (!ranked.length || (tied && !uniquePassage)) return { explanation: null, status: "NO_APPROVED_EXPLANATION" };
      const selected = ranked[0], apiUrl = `${BASE}one/?language=ar&id=${selected.record.id}`;
      const detail = HadeethEncDetailSchema.parse(await json(apiUrl, controller.signal));
      const match = matchExplanation(plain, detail.hadeeth, query);
      if (!match || detail.id !== selected.record.id || !detail.explanation.trim()) return { explanation: null, status: "NO_APPROVED_EXPLANATION" };
      return { status: "AVAILABLE", explanation: { evidenceId: item.id, provider: "HADEETHENC", sourceId: detail.id, title: detail.title,
        exactHadithText: detail.hadeeth, exactExplanation: detail.explanation, attribution: detail.attribution, grade: detail.grade, reference: detail.reference, hints: detail.hints,
        sourceName: HADEETHENC_SOURCE_NAME, sourceUrl: null, apiUrl, matchMethod: match.method } };
    };
    try { return await Promise.race([work(), deadline]); }
    catch { return { explanation: null, status: "UNAVAILABLE" }; }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); controller.abort(); }
  }
  return {
    async resolve(item: EvidenceCandidate, hint?: string): Promise<ExplanationResult> {
      if (item.sourceType !== "HADITH") return { explanation: null, status: "NO_APPROVED_EXPLANATION" };
      const key = createHash("sha256").update(JSON.stringify([item.id, item.exactText, item.metadata.displayText, hint ?? null])).digest("hex");
      const hit = cache.get(key); if (hit && hit.until > now()) return structuredClone(hit.value);
      if (pending.has(key)) return structuredClone(await pending.get(key)!);
      const request = lookup(item, hint); pending.set(key, request);
      try {
        const result = await request;
        if (result.status !== "UNAVAILABLE") {
          remember(cache, key, result, now() + (result.status === "AVAILABLE" ? TTL : 60_000));
        }
        return structuredClone(result);
      } finally { pending.delete(key); }
    },
  };
}
export const hadeethEncResolver = createHadeethEncResolver();

export async function resolveApprovedExplanations(evidence: readonly EvidenceCandidate[], hint?: string): Promise<{ explanations: EvidenceExplanation[]; explanationStatus: "AVAILABLE" | "NO_APPROVED_EXPLANATION" | "UNAVAILABLE" }> {
  const results = await Promise.all(evidence.filter((item) => item.sourceType === "HADITH").map((item) => hadeethEncResolver.resolve(item, hint)));
  const explanations = results.flatMap((result) => result.explanation ? [result.explanation] : []);
  return { explanations, explanationStatus: explanations.length ? "AVAILABLE" : results.some((result) => result.status === "UNAVAILABLE") ? "UNAVAILABLE" : "NO_APPROVED_EXPLANATION" };
}
export async function withApprovedExplanations(result: EvidenceResult, hint?: string): Promise<EvidenceResult> {
  if (!result.evidence.some((item) => item.sourceType === "HADITH")) return result;
  return { ...result, ...await resolveApprovedExplanations(result.evidence, hint) };
}
