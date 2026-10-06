import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClaimExtractionProvider } from "../src/ai/configured-provider";
import { extractClaims } from "../src/ai/claim-extraction";
import { parseEnv } from "../src/lib/env";
import { claim } from "./fixtures/claims";

const { groq, gemini } = vi.hoisted(() => ({ groq: { extract: vi.fn() }, gemini: { extract: vi.fn() } }));
vi.mock("../src/ai/providers/groq", () => ({ groqProvider: groq }));
vi.mock("../src/ai/providers/gemini", () => ({ geminiProvider: gemini }));
beforeEach(() => { groq.extract.mockReset(); gemini.extract.mockReset(); vi.stubEnv("AI_PROVIDER", undefined); vi.stubEnv("GROQ_API_KEY", "test-only-key"); });
afterEach(() => vi.unstubAllEnvs());

describe("configured claim extraction provider", () => {
  it("defaults to Groq and leaves Gemini inactive", async () => {
    const text = "A sufficiently long statement."; groq.extract.mockResolvedValue({ claims: [claim(text)] });
    expect(getClaimExtractionProvider()).toBe(groq);
    expect((await extractClaims(text)).claims).toHaveLength(1);
    expect(groq.extract).toHaveBeenCalledOnce(); expect(gemini.extract).not.toHaveBeenCalled();
  });
  it("allows explicit Gemini selection without invoking Groq", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini"); gemini.extract.mockResolvedValue({ claims: [] });
    expect(getClaimExtractionProvider()).toBe(gemini);
    await extractClaims("A sufficiently long statement.");
    expect(gemini.extract).toHaveBeenCalledOnce(); expect(groq.extract).not.toHaveBeenCalled();
  });
  it("does not fall back to Gemini on a Groq error", async () => {
    vi.stubEnv("AI_PROVIDER", "groq"); groq.extract.mockRejectedValue(new Error("failure"));
    await expect(extractClaims("A sufficiently long statement.")).rejects.toThrow("AI_UNAVAILABLE");
    expect(gemini.extract).not.toHaveBeenCalled();
  });
  it("validates provider selection only on invocation", async () => {
    expect(() => parseEnv({ AI_PROVIDER: "unsupported", GROQ_API_KEY: "" })).not.toThrow();
    vi.stubEnv("AI_PROVIDER", "unsupported");
    await expect(extractClaims("A sufficiently long statement.")).rejects.toThrow("AI_NOT_CONFIGURED");
    expect(groq.extract).not.toHaveBeenCalled(); expect(gemini.extract).not.toHaveBeenCalled();
  });
  it("preserves the exact Arabic test's separate quote and interpretation contract", async () => {
    const text = "قال الكاتب: «إنما الأعمال بالنيات»، ثم ذكر أن هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول.";
    groq.extract.mockResolvedValue({ claims: [claim("إنما الأعمال بالنيات", { claimType: "QUOTE", attributedTo: "الكاتب" }), claim("هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول", { claimType: "INTERPRETATION", attributedTo: "الكاتب" })] });
    const result = await extractClaims(text);
    expect(result.claims.map((item) => item.claimType)).toEqual(["QUOTE", "INTERPRETATION"]);
    for (const item of result.claims) {
      expect(text.slice(item.originalStart!, item.originalEnd!)).toBe(item.text);
      expect(item).not.toHaveProperty("verificationStatus"); expect(item.sourceMentioned).toBeNull();
    }
  });
});
