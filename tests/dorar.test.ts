// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import captures from "./fixtures/dorar-live.json";
import { claim } from "./fixtures/claims";
import { createDorarProvider, parseDorarResponse, dorarQuery, dorarSearchText, DORAR_CACHE_LIMIT, DORAR_CACHE_TTL_MS, DORAR_TIMEOUT_MS } from "../src/evidence/providers/dorar";
import { retrieveEvidence } from "../src/evidence/retriever";
import { lexicalScore } from "../src/evidence/matching";
import { EvidenceCandidateSchema, evidenceSourceUrl } from "../src/evidence/types";
import { analyzeEvidenceRelation } from "../src/ai/evidence-reasoning";
import { relation } from "./fixtures/relation";

const captured = captures[0];
const signal = () => new AbortController().signal;
const quote = claim(captured.query, { claimType: "QUOTE" });
// Synthetic markup for adversarial cases; religious text is copied from the live fixture.
function markup(text: string, info = "", link = "") { return `<div class="hadith">1 - ${text}</div>${info ? `<div class="hadith-info">${info}</div>` : ""}${link}`; }
const phrase = "من غشنا فليس منا";
const body = (result: string) => ({ ahadith: { result } });
const response = () => Response.json(captured.response);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("official Dorar response parsing", () => {
  it("parses captured ahadith.result, preserving exact wording, qualifications and reported grades", () => {
    const items = parseDorarResponse(captured.response);
    expect(items).toHaveLength(15);
    expect(items[0]).toMatchObject({ sourceType: "HADITH", sourceName: "الدرر السنية", canonicalUrl: null, reference: "ذخيرة الحفاظ، 4/2342", metadata: { narrator: "أبو هريرة", scholar: "ابن القيسراني", book: "ذخيرة الحفاظ", pageOrNumber: "4/2342", grading: "[فيه] الحسين بن علي بن الأسود كان يسرق الحديث من الثقات وأحاديثه لا يتابع عليها" } });
    expect(items[0].exactText).toBe("من غشَّنا فليسَ منَّا [يعني حديث: مَن حَمَلَ عليْنا السِّلاحَ فليسَ مِنَّا، ومَن غَشَّنا فليسَ مِنَّا.] .");
    expect(items[0].metadata.sourceUrl).toContain("https://dorar.net/hadith/search?q=");
    expect(items[0]).not.toHaveProperty("verificationStatus");
  });
  it("supports the documented th envelope with the same captured HTML, without assuming separate fields", () => {
    const raw = { ahadith: [{ th: captured.response.ahadith.result }] };
    expect(parseDorarResponse(raw)).toEqual(parseDorarResponse(captured.response));
  });
  it("uses only labeled metadata, never guesses grading, number, page, narrator or individual links", () => {
    const [item] = parseDorarResponse(body(markup(phrase)));
    expect(item).toMatchObject({ reference: null, canonicalUrl: null, metadata: { narrator: null, scholar: null, book: null, pageOrNumber: null, grading: null } });
    expect(EvidenceCandidateSchema.safeParse(item).success).toBe(true);
    expect(evidenceSourceUrl(item)).toBeNull();
    const [ambiguous] = parseDorarResponse(body(markup(phrase, "الراوي: أ | الراوي: ب")));
    expect(ambiguous.metadata.narrator).toBeNull();
  });
  it("recognizes a safe individual link only when it is actually provided", () => {
    const [item] = parseDorarResponse(body(markup(phrase, 'المصدر: كتاب <a href="/h/abc123">الرابط</a>')));
    expect(item.canonicalUrl).toBe("https://dorar.net/h/abc123");
    expect(parseDorarResponse(body(markup(phrase, '<a href="javascript:alert(1)">x</a>')))[0].canonicalUrl).toBeNull();
    expect(evidenceSourceUrl({ ...item, canonicalUrl: null, metadata: { sourceUrl: "https://evil.test" } })).toBeNull();
  });
  it("strips markup and skips active/hidden content without losing diacritics or decoding twice", () => {
    const [item] = parseDorarResponse(body(markup('<span onclick="evil()">مَنْ</span> غَشَّنَا فَلَيْسَ مِنَّا &amp; &lt;img&gt;<script>سر</script><style>سر</style><iframe>سر</iframe><span hidden>سر</span><img src="https://evil.test" />')));
    expect(item.exactText).toBe("مَنْ غَشَّنَا فَلَيْسَ مِنَّا & <img>");
    expect(item.exactText).not.toContain("سر");
  });
  it("accepts genuine empty results", () => {
    expect(parseDorarResponse({ ahadith: [] })).toEqual([]);
    expect(parseDorarResponse(body(""))).toEqual([]);
  });
  it.each([{}, { ahadith: [{ th: null }] }, { ahadith: [{ th: "" }] }, { ahadith: [{ th: "   " }] }, { ahadith: [{ th: "<html>error</html>" }] }, body(markup("")), body('<div class="hadith-info">الراوي: أ</div>'), body("x".repeat(400_001))])("rejects malformed/unknown results instead of presenting them as evidence", (raw) => {
    expect(() => parseDorarResponse(raw)).toThrow("INVALID_EVIDENCE_RESPONSE");
  });
});

describe("queries, ranking and runtime integration", () => {
  it("prefers a quoted substring over commentary, bounds long queries, and skips unsupported interpretation searches", () => {
    const text = `قال الكاتب: «${phrase}»، ثم أضاف تفسيرًا من عنده.`;
    expect(dorarSearchText(claim(text))).toBe(phrase);
    expect(dorarQuery("مَنْ غَشَّنَا فَلَيْسَ مِنَّا")).toBe(phrase);
    expect(dorarQuery((phrase + " ").repeat(100)).length).toBeLessThanOrEqual(160);
    expect(dorarQuery((phrase + " ").repeat(100)).split(" ").length).toBeLessThanOrEqual(12);
    expect(dorarSearchText(claim("كل عمل لا يشعر صاحبه بالراحة النفسية غير مقبول", { claimType: "INTERPRETATION" }))).toBeNull();
  });
  it("ranks normalized exact, near phrase, and overlapping text in that order", () => {
    const query = "إنما الأعمال بالنيات";
    expect(lexicalScore(query, "إِنَّما الأعمالُ بالنياتِ")).toBe(1);
    expect(lexicalScore(query, "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى")).toBe(0.98);
    expect(lexicalScore(query, "الأعمال مردها إلى النيات بالنيات")).toBeLessThan(0.98);
  });
  it("returns five locally strongest results from a real fixture and no old-corpus IDs", async () => {
    const fetcher = vi.fn().mockImplementation(response); vi.stubGlobal("fetch", fetcher);
    const items = await createDorarProvider().retrieve(quote, signal());
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.id.startsWith("dorar-api-"))).toBe(true);
    expect(items[0].relevanceScore).toBe(1);
    expect(items[0].exactText).not.toContain("[يعني حديث:");
    expect(fetcher).toHaveBeenCalledWith(`https://dorar.net/dorar_api.json?skey=${encodeURIComponent(quote.text)}`, expect.objectContaining({ method: "GET", cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it("rejects unrelated results, removes duplicate source records, and keeps source snapshots compatible with reasoning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body(markup(phrase) + markup(phrase)))));
    const items = await createDorarProvider().retrieve(quote, signal());
    expect(items).toHaveLength(1);
    const snapshot = JSON.stringify(items);
    const result = await analyzeEvidenceRelation({ claim: quote, evidence: items }, { analyze: async () => ({ analysis: relation({ strongestEvidenceId: items[0].id }) }) });
    expect(result.analysis.verificationStatus).toBe("SUPPORTED"); expect(JSON.stringify(items)).toBe(snapshot);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response));
    expect(await createDorarProvider().retrieve(claim("تم افتتاح محطة القطار أمس"), signal())).toEqual([]);
  });
  it("normal retrieval returns a Sahihayn hit immediately without contacting Dorar", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(url.startsWith("https://dorar.net/") ? response() : Response.json({ items: [] })));
    vi.stubGlobal("fetch", fetcher);
    expect((await retrieveEvidence(quote)).evidence.every((item) => item.id.startsWith("sahihayn-"))).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(readFileSync("src/evidence/retriever.ts", "utf8")).not.toContain("fixtures");
  });
});

describe("bounded cache and upstream failures", () => {
  it("shares in-flight work, caches by normalized query, and isolates consumer mutations", async () => {
    const fetcher = vi.fn().mockImplementation(response); vi.stubGlobal("fetch", fetcher);
    const provider = createDorarProvider();
    const [a, b] = await Promise.all([provider.retrieve(quote, signal()), provider.retrieve(claim("مَنْ غَشَّنَا فَلَيْسَ مِنَّا"), signal())]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    a[0].metadata.scholar = "changed";
    expect(b[0].metadata.scholar).not.toBe("changed");
    expect((await provider.retrieve(quote, signal()))[0].metadata.scholar).not.toBe("changed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("expires and evicts cached queries; failure never populates the cache", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(response); vi.stubGlobal("fetch", fetcher);
    const provider = createDorarProvider(); await provider.retrieve(quote, signal());
    await vi.advanceTimersByTimeAsync(DORAR_CACHE_TTL_MS + 1); await provider.retrieve(quote, signal());
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (let i = 0; i < DORAR_CACHE_LIMIT; i++) await provider.retrieve(claim(`${phrase} عبارة${i}`), signal());
    await provider.retrieve(quote, signal()); expect(fetcher).toHaveBeenCalledTimes(DORAR_CACHE_LIMIT + 3);
  });
  it.each([403, 500, 503])("maps HTTP %s to safe unavailable, without fallback or error-body leakage", async (status) => {
    const fetcher = vi.fn().mockImplementation(() => new Response("private upstream content", { status })); vi.stubGlobal("fetch", fetcher);
    const provider = createDorarProvider();
    await expect(provider.retrieve(quote, signal())).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE", message: "EVIDENCE_UNAVAILABLE" });
    await expect(provider.retrieve(quote, signal())).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["{", JSON.stringify({ ahadith: [{ th: 1 }] }), "x".repeat(512 * 1024 + 1)])("rejects malformed JSON/schema and oversized streamed bodies", async (raw) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw, { headers: { "Content-Type": "application/json" } })));
    await expect(createDorarProvider().retrieve(quote, signal())).rejects.toMatchObject({ code: "INVALID_EVIDENCE_RESPONSE" });
  });
  it("bounds an uncooperative fetch with a five-second hard deadline", async () => {
    vi.useFakeTimers(); let received!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options) => { received = options.signal; return new Promise(() => {}); }));
    const result = expect(createDorarProvider().retrieve(quote, signal())).rejects.toMatchObject({ code: "EVIDENCE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(DORAR_TIMEOUT_MS); await result; expect(received.aborted).toBe(true);
  });
  it("cancels one waiter without cancelling shared work for another", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; })));
    const provider = createDorarProvider(); const controller = new AbortController();
    const cancelled = expect(provider.retrieve(quote, controller.signal)).rejects.toMatchObject({ code: "EVIDENCE_TIMEOUT" });
    const active = provider.retrieve(quote, signal()); controller.abort(); await cancelled;
    resolve(response()); expect(await active).toHaveLength(5);
  });
});
