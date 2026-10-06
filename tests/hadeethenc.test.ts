// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHadeethEncResolver, HADEETHENC_TIMEOUT_MS } from "../src/evidence/explanations/hadeethenc";
import { matchExplanation } from "../src/evidence/explanations/matching";
import { EvidenceExplanationSchema, HadeethEncDetailSchema, HadeethEncSearchSchema } from "../src/evidence/explanations/types";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import type { EvidenceCandidate } from "../src/evidence/types";
import { fixtureSourceFetch, officialDetails } from "./fixtures/hadeethenc-transport";
import searchIntentions from "./fixtures/hadeethenc-search-intentions.json";
import searchUnderstanding from "./fixtures/hadeethenc-search-understanding.json";
import searchPurity from "./fixtures/hadeethenc-search-purity.json";
import intentionsNarration from "./fixtures/hadeethenc-intentions-narration.json";
import { bukhari71Quote } from "./fixtures/bukhari-71";
import { quotationClaim, hadithEvidence } from "./fixtures/relation";
import { claim } from "./fixtures/claims";
import * as explanationService from "../src/evidence/explanations/hadeethenc";
import { analyzeEvidenceRelation } from "../src/ai/evidence-reasoning";
import { relation } from "./fixtures/relation";

let b1: EvidenceCandidate, b71: EvidenceCandidate, m223: EvidenceCandidate;
beforeAll(async () => {
  b1 = (await localSahihaynProvider.retrieve(quotationClaim, new AbortController().signal)).find(x => x.id === "sahihayn-bukhari-1")!;
  b71 = (await localSahihaynProvider.retrieve(bukhari71Quote, new AbortController().signal)).find(x => x.id === "sahihayn-bukhari-71")!;
  m223 = (await localSahihaynProvider.retrieve(claim("الطهور شطر الإيمان", { claimType: "QUOTE" }), new AbortController().signal)).find(x => x.id === "sahihayn-muslim-223")!;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const transport = (search: unknown, detail: unknown = officialDetails[1]) => vi.fn<typeof fetch>().mockImplementation(async (url) => Response.json(String(url).includes("/search/") ? search : detail));

describe("conservative official explanation matching", () => {
  it("matches exact normalized matn without changing either source", () => {
    const original = officialDetails[1].hadeeth;
    expect(matchExplanation(original, original)?.method).toBe("EXACT_TEXT");
    expect(matchExplanation("من يرد الله به خيرا يفقهه في الدين", "«مَن يُرِدِ اللهُ به خيرًا يُفقِّهه في الدِّين»")?.method).toBe("EXACT_TEXT");
    expect(officialDetails[1].hadeeth).toBe(original);
  });
  it("allows distinctive contiguous phrases", () => {
    expect(matchExplanation("إنما الأعمال بالنيات", officialDetails[0].hadeeth)?.method).toBe("PHRASE_CONTAINMENT");
  });
  it.each(["الله رسول النبي", "خير", "دين", "الصلاة مهمة", "محطة القطار افتتحت أمس", "من في على إلى"])("rejects weak or unrelated overlap: %s", (text) => {
    expect(matchExplanation(text, officialDetails[1].hadeeth)).toBeNull();
  });
  it("cannot turn an unrelated claim hint into a source match", () => {
    expect(matchExplanation("حدثنا زيد أن القطار وصل أمس", officialDetails[1].hadeeth, "من يرد الله به خيرا يفقهه في الدين")).toBeNull();
  });
  it("accepts current real search/detail shapes and strips highlight markup", () => {
    for (const response of [searchIntentions, searchUnderstanding, searchPurity]) expect(HadeethEncSearchSchema.safeParse(response).success).toBe(true);
    for (const response of officialDetails) expect(HadeethEncDetailSchema.safeParse(response).success).toBe(true);
    expect(HadeethEncSearchSchema.parse(searchUnderstanding)[0]).not.toHaveProperty("hadith_text_highlights");
  });
});

describe("bounded official source adapter", () => {
  it.each(["Bukhari 1", "Muslim 223"])("retains %s retrieval/provenance through independent quotation reasoning without source mutation", async (name) => {
    const item = name === "Bukhari 1" ? b1 : m223, text = name === "Bukhari 1" ? "إنما الأعمال بالنيات" : "الطهور شطر الإيمان";
    const fetcher = name === "Bukhari 1" ? transport(searchIntentions, intentionsNarration) : transport(searchPurity, officialDetails[2]);
    const before = JSON.stringify(item), lookup = await createHadeethEncResolver({ fetcher }).resolve(item, text);
    vi.spyOn(explanationService, "resolveApprovedExplanations").mockResolvedValue({ explanations: lookup.explanation ? [lookup.explanation] : [], explanationStatus: lookup.status });
    const provider = { analyze: vi.fn().mockResolvedValue({ analysis: relation({ strongestEvidenceId: item.id, supportedMeaning: "الاقتباس مطابق للنص المقدم.", reasoning: "تقييم اقتباس حرفي ضمن الدليل المتاح، دون تفسير ديني مستقل." }) }) };
    const result = await analyzeEvidenceRelation({ claim: claim(text, { claimType: "QUOTE" }), evidence: [item] }, provider);
    expect(result.analysis).toMatchObject({ verificationStatus: "SUPPORTED", relationType: "DIRECT_QUOTE", strongestEvidenceId: item.id });
    expect(provider.analyze.mock.calls[0][0].approvedExplanations).toEqual(lookup.explanation ? [lookup.explanation] : []);
    expect(item.reference).toBe(name === "Bukhari 1" ? "صحيح البخاري، حديث 1" : "صحيح مسلم، حديث 223");
    expect(JSON.stringify(item)).toBe(before); expect(provider.analyze).toHaveBeenCalledOnce();
  });
  it("resolves Bukhari 71 from real captured responses, retains exact provenance and never mutates source", async () => {
    const fetcher = transport(searchUnderstanding), before = JSON.stringify(b71);
    const result = await createHadeethEncResolver({ fetcher }).resolve(b71, bukhari71Quote.text);
    expect(result.status).toBe("AVAILABLE"); expect(result.explanation).toMatchObject({ evidenceId: b71.id, sourceId: officialDetails[1].id, exactExplanation: officialDetails[1].explanation, reference: officialDetails[1].reference, grade: officialDetails[1].grade, sourceUrl: null });
    expect(EvidenceExplanationSchema.safeParse(result.explanation).success).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(JSON.stringify(b71)).toBe(before);
    expect(fetcher.mock.calls.every(([url, options]) => new URL(String(url)).origin === "https://hadeethenc.com" && options?.redirect === "error")).toBe(true);
  });
  it("resolves a longer uniquely agreeing Bukhari 1 narration without a hardcoded record mapping", async () => {
    const result = await createHadeethEncResolver({ fetcher: transport(searchIntentions, intentionsNarration) }).resolve(b1, quotationClaim.text);
    expect(result.status).toBe("AVAILABLE"); expect(result.explanation?.sourceId).toBe(intentionsNarration.id); expect(result.explanation?.exactExplanation).toBe(intentionsNarration.explanation);
  });
  it("safely rejects the equally strong Muslim 223 narration matches observed in the live search", async () => {
    const fetcher = transport(searchPurity, officialDetails[2]);
    expect((await createHadeethEncResolver({ fetcher }).resolve(m223, "الطهور شطر الإيمان")).status).toBe("NO_APPROVED_EXPLANATION");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("retains Muslim 223 exact explanation if the source supplies a unique defensible match", async () => {
    const result = await createHadeethEncResolver({ fetcher: fixtureSourceFetch }).resolve(m223, "الطهور شطر الإيمان");
    expect(result.explanation?.exactExplanation).toBe(officialDetails[2].explanation); expect(result.explanation?.reference).toBe(officialDetails[2].reference);
  });
  it("does not choose an arbitrary ID on equal matches", async () => {
    const record = searchUnderstanding.find(x => x.id === officialDetails[1].id)!;
    const fetcher = transport([record, { ...record, id: "99999999" }]);
    expect((await createHadeethEncResolver({ fetcher }).resolve(b71)).status).toBe("NO_APPROVED_EXPLANATION"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("returns no match for unrelated evidence rather than inventing an explanation", async () => {
    expect((await createHadeethEncResolver({ fetcher: fixtureSourceFetch }).resolve({ ...hadithEvidence, exactText: "افتتحت محطة القطار أمس في المدينة" })).explanation).toBeNull();
  });
  it.each([{}, [{ id: "123", title: "عنوان", hadeeth: "حقل غير مطابق" }], "not-json"])("handles malformed search without losing hadith evidence", async (raw) => {
    expect((await createHadeethEncResolver({ fetcher: transport(raw) }).resolve(b71)).status).toBe("UNAVAILABLE");
  });
  it.each([{ ...officialDetails[1], explanation: null }, { ...officialDetails[1], hints: "bad" }, { ...officialDetails[1], reference: 12 }])("rejects malformed detail", async (raw) => {
    expect((await createHadeethEncResolver({ fetcher: transport(searchUnderstanding, raw) }).resolve(b71)).status).toBe("UNAVAILABLE");
  });
  it("rejects a mismatched detail ID or a blank explanation", async () => {
    for (const detail of [{ ...officialDetails[1], id: "999" }, { ...officialDetails[1], explanation: "   " }]) expect((await createHadeethEncResolver({ fetcher: transport(searchUnderstanding, detail) }).resolve(b71)).status).toBe("NO_APPROVED_EXPLANATION");
  });
  it("rejects explanation metadata with invented public URL or mismatched API provenance", async () => {
    const { explanation } = await createHadeethEncResolver({ fetcher: fixtureSourceFetch }).resolve(b71);
    expect(EvidenceExplanationSchema.safeParse({ ...explanation, sourceUrl: "https://hadeethenc.com/ar/browse/hadith/123" }).success).toBe(false);
    expect(EvidenceExplanationSchema.safeParse({ ...explanation, sourceId: "999" }).success).toBe(false);
    expect(EvidenceExplanationSchema.safeParse({ ...explanation, apiUrl: "https://evil.test/api/v1/hadeeths/one/?language=ar&id=5518" }).success).toBe(false);
  });
  it("deduplicates concurrent source lookups, caches bounded successful data and returns independent clones", async () => {
    const fetcher = vi.fn(fixtureSourceFetch), resolver = createHadeethEncResolver({ fetcher });
    const [a, b] = await Promise.all([resolver.resolve(b71), resolver.resolve(b71)]);
    a.explanation!.hints.push("تغيير محلي"); expect(b.explanation!.hints).not.toContain("تغيير محلي");
    expect((await resolver.resolve(b71)).explanation!.hints).not.toContain("تغيير محلي"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("expires source and explanation cache after ten minutes", async () => {
    let now = 0; const fetcher = vi.fn(fixtureSourceFetch), resolver = createHadeethEncResolver({ fetcher, now: () => now });
    await resolver.resolve(b71); now = 600_001; await resolver.resolve(b71); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("does not cache provider failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 503 })).mockImplementation(fixtureSourceFetch);
    const resolver = createHadeethEncResolver({ fetcher });
    expect((await resolver.resolve(b71)).status).toBe("UNAVAILABLE"); expect((await resolver.resolve(b71)).status).toBe("AVAILABLE"); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("bounds waiting for an uncooperative source to three seconds", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const work = createHadeethEncResolver({ fetcher }).resolve(b71);
    await vi.advanceTimersByTimeAsync(HADEETHENC_TIMEOUT_MS); expect((await work).status).toBe("UNAVAILABLE"); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("does not request hadith explanations for Quran evidence", async () => {
    const fetcher = vi.fn(); expect((await createHadeethEncResolver({ fetcher }).resolve({ ...hadithEvidence, sourceType: "QURAN" })).explanation).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
});
