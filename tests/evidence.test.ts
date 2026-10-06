// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { localHadithProvider } from "./fixtures/local-hadith";
import { quranpediaProvider } from "../src/evidence/providers/quranpedia";
import { rankEvidence, retrieveEvidence, RETRIEVAL_TIMEOUT_MS } from "../src/evidence/retriever";
import { EvidenceCandidateSchema, EvidenceRetrievalError, type EvidenceCandidate } from "../src/evidence/types";
import corpus from "./fixtures/hadith.json";
import { claim } from "./fixtures/claims";

const candidate = EvidenceCandidateSchema.parse(corpus[0]);
const cited = claim("قل هو الله أحد", { claimType: "QUOTE", sourceMentioned: "القرآن 112:1" });
const ayah = { id: 6222, number: 1, surah: "112", page_number: 604, text: "قُلْ هُوَ اللَّهُ أَحَدٌ" };
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("curated hadith retrieval", () => {
  it("retrieves the intentions quote with exact source text and checked metadata", async () => {
    const result = await retrieveEvidence(claim("إنما الأعمال بالنيات"), [localHadithProvider]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ id: "dorar-67613", exactText: corpus[0].exactText, canonicalUrl: "https://dorar.net/hadith/sharh/67613", reference: "غاية المرام، 401", metadata: { narrator: "عمر بن الخطاب", dataset: "curated-competition-v1" } });
    expect(result.evidence[0]).not.toHaveProperty("verificationStatus");
  });
  it.each(["الدين النصيحة", "لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه"])("retrieves the other curated entry: %s", async (text) => {
    expect((await localHadithProvider.retrieve(claim(text), signal()))).toHaveLength(1);
  });
  it.each(["The train station opened in 1950.", "تم افتتاح محطة القطار الجديدة أمس", "قال الله", "قال الكاتب إن الأرض تدور حول الشمس"])("returns no invented evidence for %s", async (text) => {
    expect(await localHadithProvider.retrieve(claim(text), signal())).toEqual([]);
  });
  it("keeps normalization out of the actual source text", async () => {
    const result = await localHadithProvider.retrieve(claim("انما الاعمال بالنيات"), signal());
    expect(result[0].exactText).toBe(corpus[0].exactText);
  });
});

describe("Quranpedia", () => {
  it("preserves exact Quran text, reference, Hafs metadata and canonical ayah ID", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(ayah)); vi.stubGlobal("fetch", fetcher);
    const result = await quranpediaProvider.retrieve(cited, signal());
    expect(result[0]).toMatchObject({ exactText: ayah.text, reference: "112:1", canonicalUrl: "https://quranpedia.net/surah/1/112?ayah_id=6222", metadata: { mushafId: 1, ayahId: 6222 } });
    expect(fetcher).toHaveBeenCalledWith("https://api.quranpedia.net/v1/mushafs/1/112/1", expect.objectContaining({ redirect: "error", cache: "no-store" }));
  });
  it("supports Arabic digits in an explicit Quran reference", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(ayah)));
    expect((await quranpediaProvider.retrieve({ ...cited, sourceMentioned: "القرآن ١١٢:١" }, signal()))[0].reference).toBe("112:1");
  });
  it("discovers verse references by topic keywords and filters unrelated verses", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ id: 336, name: "الصبر", ayahs: "2:45,2:46" }] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ id: 52, number: 45, surah: "2", page_number: 7, text: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ" }))
      .mockResolvedValueOnce(Response.json({ id: 53, number: 46, surah: "2", page_number: 7, text: "نص اختبار غير مطابق" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await quranpediaProvider.retrieve(claim("الصبر والصلاة"), signal());
    expect(result.map((item) => item.reference)).toEqual(["2:45"]);
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("https://api.quranpedia.net/v1/"))).toBe(true);
  });
  it("returns empty on a genuine topic miss", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ items: [] }))));
    expect(await quranpediaProvider.retrieve(claim("محطة قطار جديدة"), signal())).toEqual([]);
  });
  it("keeps original tafsir markup separate from safe display text and retains book/page metadata", async () => {
    const raw = "<p>نص تفسير محفوظ<br>بدون إعادة صياغة</p><script>alert(1)</script>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(ayah)).mockResolvedValueOnce(Response.json({ book: { id: 1, name: "تيسير التفسير", author: { ar_name: "إبراهيم القطان" }, edition: "" }, content: [{ text: raw, part: "3", page: 458, ayahs: "6222,6223,6224,6225" }] })));
    const result = await quranpediaProvider.retrieve({ ...cited, claimType: "INTERPRETATION" }, signal());
    expect(result[1]).toMatchObject({ sourceType: "TAFSIR", exactText: raw, metadata: { part: "3", page: 458, edition: null } });
    expect(result[1].metadata.displayText).toBe("نص تفسير محفوظ\nبدون إعادة صياغة");
  });
  it.each([{ unexpected: [] }, { ...ayah, text: "" }, { ...ayah, surah: "113" }, { ...ayah, number: 2 }])("rejects malformed or mismatched verse responses", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(quranpediaProvider.retrieve(cited, signal())).rejects.toMatchObject({ code: "INVALID_EVIDENCE_RESPONSE" });
  });
  it("rejects malformed search data and upstream HTTP errors", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ name: "broken" }] })).mockResolvedValueOnce(new Response("upstream private", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(quranpediaProvider.retrieve(claim("محطة قطار جديدة"), signal())).rejects.toMatchObject({ code: "INVALID_EVIDENCE_RESPONSE" });
    await expect(quranpediaProvider.retrieve(cited, signal())).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE" });
  });
  it("rejects invalid JSON, HTML and oversized source responses", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("{", { headers: { "Content-Type": "application/json" } })).mockResolvedValueOnce(new Response("<html>error</html>"))
      .mockResolvedValueOnce(new Response("x".repeat(512 * 1024 + 1), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    for (let i = 0; i < 3; i++) await expect(quranpediaProvider.retrieve(cited, signal())).rejects.toMatchObject({ code: "INVALID_EVIDENCE_RESPONSE" });
  });
});

describe("retrieval service", () => {
  it("ranks strongest relevance first, deduplicates and excludes zero scores", () => {
    const low = { ...candidate, id: "low", reference: "other", relevanceScore: 0.7 };
    const high = { ...candidate, relevanceScore: 0.98 };
    expect(rankEvidence([low, high, high, { ...low, id: "zero", relevanceScore: 0 }]).map((item) => item.id)).toEqual([high.id, "low"]);
  });
  it("combines and ranks providers regardless of completion order", async () => {
    const result = await retrieveEvidence(cited, [{ retrieve: async () => [{ ...candidate, relevanceScore: 0.7 }] }, { retrieve: async () => [{ ...candidate, id: "higher", reference: "another", relevanceScore: 1 }] }]);
    expect(result.evidence.map((item) => item.id)).toEqual(["higher", candidate.id]);
  });
  it("marks partial source failures while retaining usable evidence", async () => {
    const result = await retrieveEvidence(claim("إنما الأعمال بالنيات"), [localHadithProvider, { retrieve: async () => { throw new Error("private"); } }]);
    expect(result.evidence[0].metadata.retrievalIncomplete).toBe(true);
  });
  it("never converts an upstream outage into an empty success", async () => {
    await expect(retrieveEvidence(cited, [{ retrieve: async () => [] }, { retrieve: async () => { throw new Error("private"); } }])).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE" });
  });
  it("bounds uncooperative providers and aborts their signal", async () => {
    vi.useFakeTimers(); let received!: AbortSignal;
    const work = retrieveEvidence(cited, [{ retrieve: (_, incoming) => { received = incoming; return new Promise(() => {}); } }]);
    const rejection = expect(work).rejects.toMatchObject({ code: "EVIDENCE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(RETRIEVAL_TIMEOUT_MS); await rejection;
    expect(received.aborted).toBe(true);
  });
  it("rejects malformed candidates and unapproved URLs", async () => {
    expect(EvidenceCandidateSchema.safeParse({ ...candidate, canonicalUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(EvidenceCandidateSchema.safeParse({ ...candidate, canonicalUrl: "https://dorar.net.evil.test/h/1" }).success).toBe(false);
    expect(EvidenceCandidateSchema.safeParse({ ...candidate, sourceType: "QURAN" }).success).toBe(false);
    await expect(retrieveEvidence(cited, [{ retrieve: async () => [{ text: "invented" } as unknown as EvidenceCandidate] }])).rejects.toBeInstanceOf(EvidenceRetrievalError);
  });
  it("skips nonverifiable input and propagates client cancellation", async () => {
    const provider = { retrieve: vi.fn().mockResolvedValue([]) };
    expect(await retrieveEvidence({ ...cited, isVerifiable: false }, [provider])).toEqual({ evidence: [] }); expect(provider.retrieve).not.toHaveBeenCalled();
    const abort = new AbortController(); abort.abort();
    await expect(retrieveEvidence(cited, [provider], abort.signal)).rejects.toMatchObject({ code: "EVIDENCE_TIMEOUT" });
  });
});
