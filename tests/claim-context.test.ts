// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { EvidenceRequestSchema, resolveEvidenceAnchor } from "../src/domain/claim-context";
import { resolveClaimEvidence } from "../src/evidence/resolve";
import { EvidenceResultSchema } from "../src/evidence/types";
import { claim } from "./fixtures/claims";
import { arabicExample, quotationClaim, interpretationClaim, hadithEvidence } from "./fixtures/relation";
import { bukhari71Content, bukhari71Quote, bukhari71Conclusion } from "./fixtures/bukhari-71";

const context = { claims: [quotationClaim, interpretationClaim], originalContent: arabicExample };
describe("conservative textual evidence anchors", () => {
  it.each(["ثم استنتج أن", "ثم ذكر أن", "وبناءً على ذلك", "لذلك", "ولذلك", "ومن هذا نفهم", "وهذا يدل على", "فدل ذلك على"])("anchors the source discourse connector %s omitted from extracted text", (connector) => {
    const content = bukhari71Content.replace("ثم استنتج أن", connector);
    const selected = { ...bukhari71Conclusion, originalStart: content.indexOf(bukhari71Conclusion.text), originalEnd: content.indexOf(bukhari71Conclusion.text) + bukhari71Conclusion.text.length };
    expect(resolveEvidenceAnchor(selected, [bukhari71Quote, selected], content)).toEqual({ evidenceAnchorClaimId: bukhari71Quote.id, sourceType: "TEXT" });
  });
  it("uses exact offsets to disambiguate repeated source quotations and ignores extraction array order", () => {
    const content = `${bukhari71Quote.text}؛ ${bukhari71Content}`;
    const shift = bukhari71Quote.text.length + 2;
    const quote = { ...bukhari71Quote, originalStart: bukhari71Quote.originalStart! + shift, originalEnd: bukhari71Quote.originalEnd! + shift };
    const selected = { ...bukhari71Conclusion, originalStart: bukhari71Conclusion.originalStart! + shift, originalEnd: bukhari71Conclusion.originalEnd! + shift };
    expect(resolveEvidenceAnchor(selected, [selected, quote], content)?.evidenceAnchorClaimId).toBe(quote.id);
    expect(resolveEvidenceAnchor(selected, [selected, { ...quote, originalStart: null, originalEnd: null }], content)).toBeNull();
  });
  it("does not silently replace invalid or half-supplied offsets with a guessed occurrence", () => {
    expect(resolveEvidenceAnchor({ ...bukhari71Conclusion, originalStart: 0 }, [bukhari71Quote, bukhari71Conclusion], bukhari71Content)).toBeNull();
    expect(resolveEvidenceAnchor({ ...bukhari71Conclusion, originalEnd: null }, [bukhari71Quote, bukhari71Conclusion], bukhari71Content)).toBeNull();
  });
  it("does not link a later assertion across intervening prose or to an unrelated preceding claim", () => {
    const selected = { ...bukhari71Conclusion, originalStart: null, originalEnd: null };
    const unrelated = claim("افتتحت المحطة أمس", { id: "station" });
    const quote = { ...bukhari71Quote, originalStart: null, originalEnd: null };
    expect(resolveEvidenceAnchor(selected, [quote, selected], `${quote.text}، ثم ذكر أن المحطة افتتحت أمس، ${selected.text}`)).toBeNull();
    expect(resolveEvidenceAnchor(selected, [quote, unrelated, selected], `${quote.text}، ${unrelated.text}، ثم استنتج أن ${selected.text}`)).toBeNull();
    expect(resolveEvidenceAnchor(selected, [quote, selected], `${quote.text}، ${selected.text}`)).toBeNull();
    expect(resolveEvidenceAnchor(unrelated, [quote, unrelated], `${quote.text}، ثم ذكر أن ${unrelated.text}`)).toBeNull();
  });
  it("anchors هذا الحديث even when extraction keeps only its independently verifiable conclusion", () => {
    expect(resolveEvidenceAnchor(interpretationClaim, context.claims, arabicExample)).toEqual({ evidenceAnchorClaimId: quotationClaim.id, sourceType: "HADITH" });
  });
  it.each(["هذا الحديث يعني أن", "يدل هذا الحديث على أن", "هذا النص يعني أن", "ومن ذلك نفهم أن", "وهذا يدل على أن"])("accepts the explicit bridge %s", (bridge) => {
    const selected = { ...interpretationClaim, text: `${bridge} ${interpretationClaim.text}` };
    const content = `«${quotationClaim.text}»، ${selected.text}`;
    expect(resolveEvidenceAnchor(selected, [quotationClaim, selected], content)?.evidenceAnchorClaimId).toBe(quotationClaim.id);
  });
  it("anchors these الآية to the preceding Quran claim and limits the evidence source type", () => {
    const quote = claim("إن مع العسر يسرا", { id: "verse", claimType: "QUOTE", sourceMentioned: "القرآن، سورة الشرح" });
    const interpretation = claim("هذه الآية تدل على تيسير كل أمر فورًا", { id: "conclusion", claimType: "INTERPRETATION" });
    expect(resolveEvidenceAnchor(interpretation, [quote, interpretation], `${quote.text}، ${interpretation.text}`)).toEqual({ evidenceAnchorClaimId: "verse", sourceType: "QURAN" });
  });
  it("does not anchor unrelated claims or weak thematic similarity", () => {
    const selected = claim("النيات مهمة للراحة النفسية", { id: "other", claimType: "INTERPRETATION" });
    expect(resolveEvidenceAnchor(selected, [quotationClaim, selected], `${quotationClaim.text}، ${selected.text}`)).toBeNull();
  });
  it("does not skip an intervening unrelated claim, cross paragraphs or reverse chronology", () => {
    const other = claim("افتتحت المحطة أمس", { id: "other" });
    expect(resolveEvidenceAnchor(interpretationClaim, [...context.claims, other], `${quotationClaim.text}، ${other.text}، هذا الحديث يعني أن ${interpretationClaim.text}`)).toBeNull();
    expect(resolveEvidenceAnchor(interpretationClaim, context.claims, `${quotationClaim.text}\nهذا الحديث يعني أن ${interpretationClaim.text}`)).toBeNull();
    expect(resolveEvidenceAnchor(interpretationClaim, context.claims, `هذا الحديث يعني أن ${interpretationClaim.text}، ${quotationClaim.text}`)).toBeNull();
  });
  it("does not guess which repeated quotation was referred to without defensible offsets", () => {
    expect(resolveEvidenceAnchor(interpretationClaim, context.claims, `${quotationClaim.text}، ${quotationClaim.text}، هذا الحديث يعني أن ${interpretationClaim.text}`)).toBeNull();
  });
  it("rejects a source-type contradiction", () => {
    const verse = { ...quotationClaim, sourceMentioned: "سورة الشرح" };
    expect(resolveEvidenceAnchor(interpretationClaim, [verse, interpretationClaim], arabicExample)).toBeNull();
  });
  it.each(["missing", interpretationClaim.id])("rejects invalid submitted anchor %s", (id) => {
    expect(EvidenceRequestSchema.safeParse({ claim: interpretationClaim, context: { ...context, evidenceAnchorClaimId: id } }).success).toBe(false);
  });
  it("rejects changed claims, duplicate IDs, invented content and verdict payloads", () => {
    expect(EvidenceRequestSchema.safeParse({ claim: { ...interpretationClaim, normalizedText: "different" }, context }).success).toBe(false);
    expect(EvidenceRequestSchema.safeParse({ claim: quotationClaim, context: { ...context, claims: [quotationClaim, quotationClaim] } }).success).toBe(false);
    expect(EvidenceRequestSchema.safeParse({ claim: interpretationClaim, context: { ...context, originalContent: "different" } }).success).toBe(false);
    expect(EvidenceRequestSchema.safeParse({ claim: interpretationClaim, context, analysis: { verificationStatus: "SUPPORTED" } }).success).toBe(false);
  });
});

describe("direct-first evidence resolution without verdicts", () => {
  it("prefers direct evidence and performs no anchor retrieval", async () => {
    const retrieve = vi.fn().mockResolvedValue({ evidence: [hadithEvidence] });
    const result = await resolveClaimEvidence(interpretationClaim, context, undefined, retrieve);
    expect(result.resolution).toEqual({ evidenceOrigin: "DIRECT", evidenceAnchorClaimId: null });
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
  it("falls back to an actual earlier claim, tags context and preserves all source text/metadata", async () => {
    const frozen = Object.freeze({ ...hadithEvidence, metadata: Object.freeze({ ...hadithEvidence.metadata }) });
    const snapshot = JSON.stringify(frozen);
    const retrieve = vi.fn().mockResolvedValueOnce({ evidence: [] }).mockResolvedValueOnce({ evidence: [frozen] });
    const result = await resolveClaimEvidence(interpretationClaim, context, undefined, retrieve);
    expect(retrieve.mock.calls.map((call) => call[0].id)).toEqual([interpretationClaim.id, quotationClaim.id]);
    expect(result.resolution).toEqual({ evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id });
    expect(result.evidence[0]).toBe(frozen); expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(result).not.toHaveProperty("analysis"); expect(result).not.toHaveProperty("verificationStatus");
    expect(EvidenceResultSchema.safeParse(result).success).toBe(true);
  });
  it("keeps a genuine no-evidence result when no reliable anchor evidence exists", async () => {
    const retrieve = vi.fn().mockResolvedValue({ evidence: [] });
    const result = await resolveClaimEvidence(interpretationClaim, context, undefined, retrieve);
    expect(result).toEqual({ evidence: [], resolution: { evidenceOrigin: "DIRECT", evidenceAnchorClaimId: null } });
    expect(retrieve).toHaveBeenCalledTimes(2);
  });
  it("does not fabricate context for unrelated claims", async () => {
    const selected = claim("المدينة تأسست عام ١٩٠٠", { id: "unrelated" });
    const retrieve = vi.fn().mockResolvedValue({ evidence: [] });
    expect((await resolveClaimEvidence(selected, { claims: [quotationClaim, selected], originalContent: `${quotationClaim.text}، ${selected.text}` }, undefined, retrieve)).evidence).toEqual([]);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
  it("filters out evidence that contradicts the explicit source type", async () => {
    const retrieve = vi.fn().mockResolvedValueOnce({ evidence: [] }).mockResolvedValueOnce({ evidence: [{ ...hadithEvidence, sourceType: "QURAN" }] });
    expect((await resolveClaimEvidence(interpretationClaim, context, undefined, retrieve)).resolution?.evidenceOrigin).toBe("DIRECT");
  });
  it("rejects an invalid anchor before any source request", async () => {
    const retrieve = vi.fn();
    await expect(resolveClaimEvidence(interpretationClaim, { ...context, evidenceAnchorClaimId: "invented" }, undefined, retrieve)).rejects.toThrow();
    expect(retrieve).not.toHaveBeenCalled();
  });
  it("does not turn source failures or cancellations into empty successful retrieval", async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error("unavailable"));
    await expect(resolveClaimEvidence(interpretationClaim, context, undefined, retrieve)).rejects.toThrow("unavailable");
    const cancelled = new AbortController(); cancelled.abort();
    await expect(resolveClaimEvidence(interpretationClaim, context, cancelled.signal, vi.fn().mockResolvedValue({ evidence: [] }))).rejects.toMatchObject({ code: "EVIDENCE_TIMEOUT" });
  });
  it("requires consistent provenance", () => {
    expect(EvidenceResultSchema.safeParse({ evidence: [], resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: null } }).success).toBe(false);
    expect(EvidenceResultSchema.safeParse({ evidence: [], resolution: { evidenceOrigin: "DIRECT", evidenceAnchorClaimId: "quote" } }).success).toBe(false);
  });
});
