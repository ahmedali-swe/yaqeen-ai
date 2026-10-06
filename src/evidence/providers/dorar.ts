import "server-only";
import { createHash } from "node:crypto";
import { parseDocument } from "htmlparser2";
import { z } from "zod";
import type { ExtractedClaim } from "@/domain/claim-extraction";
import { readBoundedBody } from "@/lib/read-bounded-body";
import { keywords, lexicalScore, normalizeForSearch } from "../matching";
import { EvidenceCandidateSchema, EvidenceRetrievalError, type EvidenceCandidate, type EvidenceProvider } from "../types";

export const DORAR_ENDPOINT = "https://dorar.net/dorar_api.json";
export const DORAR_TIMEOUT_MS = 5_000;
export const DORAR_CACHE_TTL_MS = 5 * 60_000;
export const DORAR_CACHE_LIMIT = 100;
const MAX_HTML = 400_000;
const MAX_RESULTS = 50;
type HtmlNode = ReturnType<typeof parseDocument>["children"][number];
const ignored = new Set(["script", "style", "head", "iframe", "object", "embed", "svg", "img", "template", "noscript"]);

/** Never execute HTML or fetch its resources. Decode entities, retain wording/diacritics. */
function plainText(root: HtmlNode): string {
  const pending = [root];
  const parts: string[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "text") parts.push(node.data);
    else if ("attribs" in node) {
      if (ignored.has(node.name) || "hidden" in node.attribs || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.attribs.style ?? "")) continue;
      if (node.name === "br") parts.push("\n");
      pending.push(...node.children.toReversed());
    } else if ("children" in node) pending.push(...node.children.toReversed());
  }
  return parts.join("").replace(/[\s\u00a0]+/gu, " ").trim();
}

function approvedLink(value: string | undefined, individual: boolean): string | null {
  if (!value || value.length > 1000) return null;
  try {
    const url = new URL(value, DORAR_ENDPOINT);
    if (url.protocol !== "https:" || url.hostname !== "dorar.net" || url.username || url.password || url.port) return null;
    if (individual ? !/^\/(?:h\/[A-Za-z0-9]+|hadith\/sharh\/\d+)\/?$/.test(url.pathname) : url.pathname !== "/hadith/search") return null;
    return url.href;
  } catch { return null; }
}

const labelPattern = /(الراوي|المحدث|المصدر|الصفحة أو الرقم|خلاصة حكم المحدث|التخريج)\s*[:：]/gu;
function parseMetadata(text: string): Record<string, string | null> {
  const labels = [...text.matchAll(labelPattern)];
  const fields: Record<string, string | null> = { narrator: null, scholar: null, book: null, pageOrNumber: null, grading: null, takhrij: null };
  const keys: Record<string, string> = { الراوي: "narrator", المحدث: "scholar", المصدر: "book", "الصفحة أو الرقم": "pageOrNumber", "خلاصة حكم المحدث": "grading", التخريج: "takhrij" };
  for (const [index, label] of labels.entries()) {
    const key = keys[label[1]];
    // Ambiguous duplicate labels cannot reliably supply a single metadata field.
    if (labels.filter((item) => item[1] === label[1]).length !== 1) continue;
    fields[key] = text.slice(label.index! + label[0].length, labels[index + 1]?.index ?? text.length).trim().replace(/\s*\|\s*$/, "").trim() || null;
  }
  return fields;
}

const html = z.string().min(1).max(MAX_HTML).refine((value) => value.trim().length > 0);
// Official documentation: ahadith[].th. Observed live API: ahadith.result HTML.
const responseSchema = z.object({ ahadith: z.union([
  z.array(z.object({ th: html })).max(MAX_RESULTS),
  z.object({ result: z.string().max(MAX_HTML) }),
]) });

export function parseDorarResponse(raw: unknown): EvidenceCandidate[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
  const value = parsed.data.ahadith;
  const fragments = Array.isArray(value) ? value.map((item) => item.th) : [value.result];
  const candidates: EvidenceCandidate[] = [];
  for (const fragment of fragments) {
    if (!fragment.trim()) continue;
    const document = parseDocument(fragment, { decodeEntities: true });
    const blocks: { text: HtmlNode; info?: HtmlNode; link: string | null }[] = [];
    let sourceUrl: string | null = null;
    const pending: HtmlNode[] = document.children.toReversed();
    let visited = 0;
    while (pending.length) {
      if (++visited > 20_000) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
      const node = pending.pop()!;
      if (!("attribs" in node)) continue;
      if (ignored.has(node.name) || "hidden" in node.attribs || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.attribs.style ?? "")) continue;
      const classes = (node.attribs.class ?? "").split(/\s+/);
      if (classes.includes("hadith")) {
        if (blocks.length >= MAX_RESULTS) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
        blocks.push({ text: node, link: null });
      } else if (classes.includes("hadith-info")) {
        const block = blocks.at(-1);
        if (!block || block.info) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
        block.info = node;
      }
      if (node.name === "a") {
        sourceUrl ??= approvedLink(node.attribs.href, false);
        const block = blocks.at(-1);
        if (block) block.link ??= approvedLink(node.attribs.href, true);
      }
      pending.push(...node.children.toReversed());
    }
    if (!blocks.length) {
      // Documented th with plain markup: accept only an explicit labeled boundary.
      // Unknown markup / an HTML error page must not become religious evidence.
      const text = plainText(document);
      if (!text || (text === "المزيد" && sourceUrl)) continue;
      const boundary = /(?:الراوي|المحدث|المصدر|خلاصة حكم المحدث)\s*[:：]/u.exec(text);
      if (!boundary) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
      const exactText = text.slice(0, boundary.index).replace(/^[0-9٠-٩]+\s*[-–]\s*/u, "").trim();
      candidates.push(candidate(exactText, parseMetadata(text.slice(boundary.index)), null, sourceUrl));
    } else {
      for (const block of blocks) {
        const exactText = plainText(block.text).replace(/^[0-9٠-٩]+\s*[-–]\s*/u, "").trim();
        const fields = parseMetadata(block.info ? plainText(block.info) : "");
        candidates.push(candidate(exactText, fields, block.link, sourceUrl));
      }
    }
    if (candidates.length > MAX_RESULTS) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
  }
  return candidates;
}

function candidate(exactText: string, fields: Record<string, string | null>, canonicalUrl: string | null, sourceUrl: string | null): EvidenceCandidate {
  if (!exactText || exactText.length > 20_000 || !/[\u0621-\u064a]/u.test(exactText)) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
  const reference = [fields.book, fields.pageOrNumber].filter(Boolean).join("، ") || null;
  const id = createHash("sha256").update(JSON.stringify([exactText, fields, canonicalUrl])).digest("hex").slice(0, 24);
  const result = EvidenceCandidateSchema.safeParse({ id: `dorar-api-${id}`, sourceType: "HADITH", title: fields.book ? `حديث — ${fields.book}` : "حديث من الموسوعة الحديثية", exactText, reference, canonicalUrl, sourceName: "الدرر السنية", relevanceScore: 0,
    metadata: { ...fields, provider: "dorar", language: "ar", apiUrl: DORAR_ENDPOINT, sourceUrl, format: "plain-text", ...(fields.grading ? { gradingAttribution: "حكم المحدث كما ورد في المصدر؛ ليس حكم يقين على الادعاء" } : {}) } });
  if (!result.success) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
  return result.data;
}

export function dorarSearchText(claim: ExtractedClaim): string | null {
  const quoted = /[«“"]([^»”"]+)[»”"]/u.exec(claim.text)?.[1];
  if (!quoted && claim.claimType === "INTERPRETATION") return null;
  if (!quoted && /قر[اآ]ن|سورة|tafsir|qur'?an|surah/i.test(`${claim.sourceMentioned ?? ""} ${claim.text}`)) return null;
  const text = (quoted ?? claim.text).trim();
  if (!/[\u0621-\u064a]/.test(text) || keywords(text).length < 2) return null;
  return text;
}

export function dorarQuery(text: string): string {
  // Only the search text changes. The full quotation still drives local ranking.
  const words = text.normalize("NFKC").replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).slice(0, 12);
  while (words.join(" ").length > 160) words.pop();
  return words.join(" ");
}

function diagnose(code: EvidenceRetrievalError["code"], status?: number) {
  if (process.env.NODE_ENV === "development") console.warn("[evidence]", { provider: "dorar", code, ...(status !== undefined ? { status } : {}) });
}

async function fetchDorar(query: string, signal: AbortSignal): Promise<EvidenceCandidate[]> {
  const response = await fetch(`${DORAR_ENDPOINT}?skey=${encodeURIComponent(query)}`, { method: "GET", signal, cache: "no-store", redirect: "error", headers: { Accept: "application/json", "User-Agent": "Yaqeen/0.1 (official API integration)" } });
  if (!response.ok) {
    await response.body?.cancel(); diagnose("EVIDENCE_UNAVAILABLE", response.status);
    throw new EvidenceRetrievalError("EVIDENCE_UNAVAILABLE");
  }
  if (!response.headers.get("content-type")?.includes("application/json")) { await response.body?.cancel(); throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE"); }
  const body = await readBoundedBody(response.body, 512 * 1024);
  if (body === null) throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE");
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { throw new EvidenceRetrievalError("INVALID_EVIDENCE_RESPONSE"); }
  return parseDorarResponse(raw);
}

/** Per-process cache, no stale/error fallback. Each caller can cancel independently. */
export function createDorarProvider(): EvidenceProvider {
  const cache = new Map<string, { expires: number; candidates: EvidenceCandidate[] }>();
  const inFlight = new Map<string, Promise<EvidenceCandidate[]>>();
  function load(query: string): Promise<EvidenceCandidate[]> {
    const key = normalizeForSearch(query);
    for (const [cachedKey, entry] of cache) if (entry.expires <= Date.now()) cache.delete(cachedKey);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached.candidates);
    const existing = inFlight.get(key);
    if (existing) return existing;
    if (inFlight.size >= 3) return Promise.reject(new EvidenceRetrievalError("EVIDENCE_UNAVAILABLE"));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new EvidenceRetrievalError("EVIDENCE_TIMEOUT")); }, DORAR_TIMEOUT_MS);
    });
    const work = Promise.race([fetchDorar(query, controller.signal), deadline]).then((candidates) => {
      if (cache.size >= DORAR_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + DORAR_CACHE_TTL_MS, candidates });
      return candidates;
    }).catch((cause: unknown) => {
      const error = cause instanceof EvidenceRetrievalError ? cause : new EvidenceRetrievalError(controller.signal.aborted ? "EVIDENCE_TIMEOUT" : "EVIDENCE_UNAVAILABLE");
      diagnose(error.code); throw error;
    }).finally(() => { clearTimeout(timer); controller.abort(); inFlight.delete(key); });
    inFlight.set(key, work);
    return work;
  }
  return {
    async retrieve(claim, signal) {
      if (signal.aborted) throw new EvidenceRetrievalError("EVIDENCE_TIMEOUT");
      const text = dorarSearchText(claim);
      if (!text) return [];
      const query = dorarQuery(text);
      if (!query || keywords(query).length < 2) return [];
      let abort!: () => void;
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(new EvidenceRetrievalError("EVIDENCE_TIMEOUT"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
      try {
        const entries = await Promise.race([load(query), interrupted]);
        const seen = new Set<string>();
        return entries.map((item) => ({ ...item, metadata: { ...item.metadata }, relevanceScore: lexicalScore(text, item.exactText) }))
          .filter((item) => item.relevanceScore > 0)
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0, 5);
      } finally { signal.removeEventListener("abort", abort); }
    },
  };
}

export const dorarProvider = createDorarProvider();
