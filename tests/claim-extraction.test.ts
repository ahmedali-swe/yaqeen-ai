import { afterEach, describe, expect, it, vi } from "vitest";
import { extractClaims, EXTRACTION_TIMEOUT_MS, validateExtraction } from "../src/ai/claim-extraction";
import { ClaimExtractionResultSchema } from "../src/domain/claim-extraction";
import { CLAIM_EXTRACTION_INSTRUCTIONS } from "../src/ai/prompts";
import { claim } from "./fixtures/claims";

afterEach(() => vi.useRealTimers());
describe("structured extraction contract (fixtures, not live evaluation)", () => {
  it("keeps an Arabic quotation separate from interpretation and preserves wording", async () => {
    const quote = "إنما الأعمال بالنيات";
    const interpretation = "وهذا يعني أن النية معيار لكل عمل";
    const text = `قال الكاتب: «${quote}»، ${interpretation}.`;
    const result = await extractClaims(text, { extract: vi.fn().mockResolvedValue({ claims: [claim(quote, { claimType: "QUOTE", attributedTo: "الكاتب" }), claim(interpretation, { claimType: "INTERPRETATION" })] }) });
    expect(result.claims.map((item) => item.claimType)).toEqual(["QUOTE", "INTERPRETATION"]);
    for (const item of result.claims) expect(text.slice(item.originalStart!, item.originalEnd!)).toBe(item.text);
    expect(result.claims[0].sourceMentioned).toBeNull();
    expect(CLAIM_EXTRACTION_INSTRUCTIONS).toContain("Familiar wording is NOT evidence");
  });
  it("accepts multiple independent English claims with shared subjects clarified only in normalizedText", async () => {
    const text = "The city was founded in 1900 and became a capital in 1920.";
    const result = await extractClaims(text, { extract: vi.fn().mockResolvedValue({ claims: [claim("The city was founded in 1900", { claimType: "HISTORICAL_CLAIM" }), claim("became a capital in 1920", { normalizedText: "The city became a capital in 1920.", claimType: "HISTORICAL_CLAIM" })] }) });
    expect(result.claims).toHaveLength(2); expect(new Set(result.claims.map((item) => item.id)).size).toBe(2);
    expect(CLAIM_EXTRACTION_INSTRUCTIONS).toContain("Split compound statements");
  });
  it("returns no claims for subjective text", async () => {
    expect(await extractClaims("أحب هذا المكان وأراه جميلًا جدًا.", { extract: vi.fn().mockResolvedValue({ claims: [] }) })).toEqual({ claims: [] });
    expect(CLAIM_EXTRACTION_INSTRUCTIONS).toContain("Ignore purely subjective");
  });
  it("filters nonverifiable output without creating a judgment", () => {
    expect(validateExtraction({ claims: [claim("I love this place.", { isVerifiable: false })] }, "I love this place.")).toEqual({ claims: [] });
  });
  it("removes duplicates without merging different attribution or negation", () => {
    const text = "A city exists. A city exists. No city exists.";
    const result = validateExtraction({ claims: [claim("A city exists."), claim("A city exists.", { id: "other" }), claim("No city exists.")] }, text);
    expect(result.claims).toHaveLength(2); expect(result.claims[0].originalStart).toBeNull();
    expect(validateExtraction({ claims: [claim("A city exists.", { attributedTo: "A" }), claim("A city exists.", { attributedTo: "B" })] }, text).claims).toHaveLength(2);
  });
  it("repairs offsets using UTF-16 and preserves valid repeated spans", () => {
    const text = "😀 This is a claim. This is a claim."; const wording = "This is a claim."; const start = text.lastIndexOf(wording);
    expect(validateExtraction({ claims: [claim(wording, { originalStart: start, originalEnd: start + wording.length })] }, text).claims[0].originalStart).toBe(start);
    expect(validateExtraction({ claims: [claim(wording, { originalStart: 2, originalEnd: 3 })] }, "😀 This is a claim.").claims[0].originalStart).toBe(3);
  });
  it("rejects altered wording absent from the input", () => {
    expect(() => validateExtraction({ claims: [claim("Invented wording.")] }, "A real submitted statement.")).toThrow("INVALID_AI_RESPONSE");
  });
  it.each([
    { claims: [claim("A claim", { claimType: "UNSUPPORTED" as never })] },
    { claims: [claim("A claim", { originalStart: -1 })] },
    { claims: [claim("A claim", { originalEnd: 1.5 })] },
    { claims: [claim("A claim", { subject: undefined as never })] },
    { claims: [{ ...claim("A claim"), verificationStatus: "SUPPORTED" }] },
    { claims: [], evidence: [] },
  ])("rejects malformed schema %j", (raw) => {
    expect(ClaimExtractionResultSchema.safeParse(raw).success).toBe(false);
    expect(() => validateExtraction(raw, "A claim")).toThrow("INVALID_AI_RESPONSE");
  });
  it("bounds a stalled provider and aborts its request", async () => {
    vi.useFakeTimers(); let signal!: AbortSignal;
    const pending = extractClaims("A sufficiently long statement.", { extract: (_, passedSignal) => { signal = passedSignal; return new Promise(() => {}); } });
    const rejected = expect(pending).rejects.toThrow("AI_TIMEOUT");
    await vi.advanceTimersByTimeAsync(EXTRACTION_TIMEOUT_MS); await rejected;
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("sanitizes unknown provider failures", async () => {
    await expect(extractClaims("A sufficiently long statement.", { extract: vi.fn().mockRejectedValue(new Error("secret key")) })).rejects.toThrow("AI_UNAVAILABLE");
  });
});
