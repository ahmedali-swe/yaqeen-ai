// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../data/hadith/manifest.json";
import { normalizeSahihaynDataset, SahihaynRecordSchema, type SahihaynRecord } from "../src/evidence/sahihayn-schema";
import { createLocalSahihaynProvider, localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { retrieveEvidence } from "../src/evidence/retriever";
import { EvidenceCandidateSchema } from "../src/evidence/types";
import { claim } from "./fixtures/claims";

const bukhari: SahihaynRecord[] = JSON.parse(readFileSync("data/hadith/bukhari.json", "utf8"));
const muslim: SahihaynRecord[] = JSON.parse(readFileSync("data/hadith/muslim.json", "utf8"));
const signal = () => new AbortController().signal;
const intentions = claim("إنما الأعمال بالنيات", { claimType: "QUOTE" });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("pinned Sahihayn corpus", () => {
  it("contains only the two requested collections with verified counts, hashes and unique source identifiers", () => {
    expect(bukhari).toHaveLength(7277); expect(muslim).toHaveLength(7368);
    for (const file of manifest.files) {
      const bytes = readFileSync(`data/hadith/${file.file}`);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.normalizedSha256);
      const records = file.collection === "bukhari" ? bukhari : muslim;
      expect(records.every((row) => SahihaynRecordSchema.safeParse(row).success && row.collection === file.collection)).toBe(true);
      expect(new Set(records.map((row) => row.id)).size).toBe(file.records);
      expect(records.every((row) => row.metadata.grading === null)).toBe(true);
      expect(records.every((row) => !("English_Text" in row) && !("narrator" in row.metadata))).toBe(true);
    }
  });
  it("preserves suffixes, ranges and combined references, without expanding or renumbering them", () => {
    expect(bukhari.find((row) => row.hadithNumber === "5709-5712")?.sourceUrl).toBe("https://sunnah.com/bukhari:5709-5712");
    expect(muslim.find((row) => row.hadithNumber === "546b-d")?.sourceUrl).toBe("https://sunnah.com/muslim:546b-d");
    expect(muslim.find((row) => row.hadithNumber === "1697/1698a")?.sourceUrl).toBe("https://sunnah.com/muslim:1697/1698a");
  });
  it("copies source Arabic byte-for-byte while leaving absent metadata null", () => {
    const Arabic_Text = `  ${bukhari[0].arabicText}  `;
    const [record] = normalizeSahihaynDataset([{ Book: "Sahih al-Bukhari", Arabic_Text, Reference: bukhari[0].sourceUrl }], "bukhari");
    expect(record.arabicText).toBe(Arabic_Text);
    expect(record.chapter).toBeNull(); expect(record.metadata).toEqual({ chapterNumber: null, inBookReference: null, grading: null });
  });
  it("fails on different collections, duplicate references or empty Arabic rather than guessing", () => {
    const row = { Book: "Sahih al-Bukhari", Arabic_Text: bukhari[0].arabicText, Reference: bukhari[0].sourceUrl };
    expect(() => normalizeSahihaynDataset([{ ...row, Book: "Sunan Abi Dawud" }], "bukhari")).toThrow();
    expect(() => normalizeSahihaynDataset([row, row], "bukhari")).toThrow("Duplicate");
    expect(() => normalizeSahihaynDataset([{ ...row, Arabic_Text: " " }], "bukhari")).toThrow();
    expect(() => normalizeSahihaynDataset([{ ...row, Reference: "https://evil.test/bukhari:1" }], "bukhari")).toThrow();
  });
});

describe("local retrieval", () => {
  it.each(["إنما الأعمال بالنيات", "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ", "انما الاعمال بالنيات"])("retrieves Bukhari 1 for %s with exact original Arabic", async (text) => {
    const result = await localSahihaynProvider.retrieve(claim(text, { claimType: "QUOTE" }), signal());
    expect(result[0]).toMatchObject({ id: "sahihayn-bukhari-1", sourceName: "صحيح البخاري", exactText: bukhari[0].arabicText, canonicalUrl: bukhari[0].sourceUrl, metadata: { retrievalRole: "LOCAL_PRIMARY", grading: null } });
    expect(result[0]).not.toHaveProperty("verificationStatus");
  });
  it("finds partial quotations and ignores an author's surrounding commentary when a quotation is explicit", async () => {
    const result = await localSahihaynProvider.retrieve(claim("قال الكاتب: «إنما الأعمال بالنيات»، ثم أضاف استنتاجًا."), signal());
    expect(result[0].id).toBe("sahihayn-bukhari-1");
    expect(result[0].exactText).toBe(bukhari[0].arabicText);
  });
  it("retrieves Muslim 223 and identifies the original collection instead of the indexing host", async () => {
    const result = await localSahihaynProvider.retrieve(claim("الطهور شطر الإيمان", { claimType: "QUOTE" }), signal());
    expect(result[0]).toMatchObject({ id: "sahihayn-muslim-223", sourceName: "صحيح مسلم", canonicalUrl: "https://sunnah.com/muslim:223" });
    expect(result[0].exactText).toBe(muslim.find((row) => row.hadithNumber === "223")!.arabicText);
  });
  it("ranks exact, contained phrase, strong and weaker overlap and returns at most five", async () => {
    // Test-only source-text slices; they never enter the production corpus.
    const texts = ["الأعمال وغاية الإنسان تتبع النيات", "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى", "إنما الأعمال بالنيات"];
    const records = texts.map((arabicText, index) => ({ ...bukhari[index], arabicText }));
    const provider = createLocalSahihaynProvider(async () => records);
    const result = await provider.retrieve(intentions, signal());
    expect(result.map((item) => item.metadata.matchMethod)).toEqual(["normalized-exact", "phrase-containment", "strong-token-overlap"]);
    expect(result.map((item) => item.relevanceScore)).toEqual([1, 0.98, 0.95]);
    const partial = createLocalSahihaynProvider(async () => [{ ...bukhari[0], arabicText: "الأعمال بالنيات، وإنما لكل" }]);
    const weaker = await partial.retrieve(claim("إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"), signal());
    expect(weaker[0].metadata.matchMethod).toBe("lexical-overlap");
    expect(weaker[0].relevanceScore).toBeLessThan(0.85);
    const many = await localSahihaynProvider.retrieve(claim("من يرد الله به خيرا يفقهه في الدين", { claimType: "QUOTE" }), signal());
    expect(many).toHaveLength(5); expect(many[0].id).toBe("sahihayn-bukhari-71");
  });
  it.each(["افتتحت محطة القطار الجديدة أمس", "The train station opened yesterday.", "قال رسول الله", "كل عمل لا يشعر صاحبه بالراحة النفسية غير مقبول"])("returns no fabricated evidence for %s", async (text) => {
    expect(await localSahihaynProvider.retrieve(claim(text), signal())).toEqual([]);
  });
  it("does not let consumers modify subsequent source snapshots", async () => {
    const first = await localSahihaynProvider.retrieve(intentions, signal()); first[0].exactText = "changed"; first[0].metadata.grading = "changed";
    const second = await localSahihaynProvider.retrieve(intentions, signal());
    expect(second[0].exactText).toBe(bukhari[0].arabicText); expect(second[0].metadata.grading).toBeNull();
  });
  it("rejects corruption or cancellation explicitly", async () => {
    const provider = createLocalSahihaynProvider(async () => [{ ...bukhari[0], arabicText: "" }]);
    await expect(provider.retrieve(intentions, signal())).rejects.toMatchObject({ code: "INVALID_EVIDENCE_RESPONSE" });
    const controller = new AbortController(); controller.abort();
    await expect(localSahihaynProvider.retrieve(intentions, controller.signal)).rejects.toMatchObject({ code: "EVIDENCE_TIMEOUT" });
  });
  it("permits supplied Sahihayn citation URLs but rejects other collections, spoofed hosts and cross-type URLs", async () => {
    const [candidate] = await localSahihaynProvider.retrieve(intentions, signal());
    expect(EvidenceCandidateSchema.safeParse(candidate).success).toBe(true);
    for (const canonicalUrl of ["https://sunnah.com/tirmidhi:1", "https://sunnah.com.evil.test/bukhari:1", "http://sunnah.com/bukhari:1", "https://sunnah.com/bukhari:1?evil=yes"]) expect(EvidenceCandidateSchema.safeParse({ ...candidate, canonicalUrl }).success).toBe(false);
    expect(EvidenceCandidateSchema.safeParse({ ...candidate, sourceType: "QURAN" }).success).toBe(false);
  });
});

describe("primary source router", () => {
  it.each(["true", "false"])("returns a primary result without any external calls with DORAR_ENABLED=%s", async (enabled) => {
    vi.stubEnv("DORAR_ENABLED", enabled); const fetcher = vi.fn().mockRejectedValue(new Error("offline / Cloudflare 403")); vi.stubGlobal("fetch", fetcher);
    const result = await retrieveEvidence(intentions);
    expect(result.evidence[0].metadata.retrievalRole).toBe("LOCAL_PRIMARY");
    expect(result.retrieval).toEqual({ hadithCorpus: "SAHIHAYN", hadith: "LOCAL_PRIMARY", dorar: enabled === "true" ? "NOT_REQUESTED" : "DISABLED", quranpedia: "NOT_REQUESTED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("discloses a local miss and optional source outage as HTTP-success data, without inventing candidates", async () => {
    vi.stubEnv("DORAR_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(url.startsWith("https://dorar.net/") ? new Response("private", { status: 403 }) : Response.json({ items: [] }))));
    const result = await retrieveEvidence(claim("افتتحت محطة القطار الجديدة أمس"));
    expect(result).toEqual({ evidence: [], retrieval: { hadithCorpus: "SAHIHAYN", hadith: "NO_LOCAL_MATCH", dorar: "UNAVAILABLE", quranpedia: "AVAILABLE" } });
  });
  it("never contacts Dorar when disabled after a genuine local miss", async () => {
    vi.stubEnv("DORAR_ENABLED", "false"); const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] })); vi.stubGlobal("fetch", fetcher);
    const result = await retrieveEvidence(claim("افتتحت محطة القطار الجديدة أمس"));
    expect(result.evidence).toEqual([]); expect(result.retrieval?.dorar).toBe("DISABLED");
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("https://api.quranpedia.net/"))).toBe(true);
  });
});
