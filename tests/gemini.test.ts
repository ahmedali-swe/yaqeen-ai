import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geminiProvider, GEMINI_MODEL } from "../src/ai/providers/gemini";
import { parseEnv } from "../src/lib/env";

const { generate, construct } = vi.hoisted(() => ({ generate: vi.fn(), construct: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {
  models = { generateContent: generate };
  constructor(options: unknown) { construct(options); }
} }));
beforeEach(() => { vi.stubEnv("GEMINI_API_KEY", "test-only-key"); generate.mockReset(); construct.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("Gemini adapter", () => {
  it("uses provider-enforced JSON schema with separate system instructions", async () => {
    generate.mockResolvedValue({ candidates: [{ finishReason: "STOP" }], text: '{"claims":[]}' });
    expect(await geminiProvider.extract("A sufficiently long statement.", new AbortController().signal)).toEqual({ claims: [] });
    expect(construct).toHaveBeenCalledWith({ apiKey: "test-only-key" });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: GEMINI_MODEL, contents: [{ role: "user", parts: [{ text: "A sufficiently long statement." }] }], config: expect.objectContaining({ responseMimeType: "application/json", responseJsonSchema: expect.objectContaining({ required: ["claims"] }), httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } } }) }));
    expect(generate.mock.calls[0][0].config.tools).toBeUndefined();
  });
  it("allows startup without a key but fails safely on invocation", async () => {
    vi.stubEnv("GEMINI_API_KEY", ""); expect(() => parseEnv({ GEMINI_API_KEY: "" })).not.toThrow();
    await expect(geminiProvider.extract("A sufficiently long statement.", new AbortController().signal)).rejects.toThrow("AI_NOT_CONFIGURED");
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([undefined, "```json\n{\"claims\":[]}\n```", "not json"])("rejects empty or free-form output: %s", async (text) => {
    generate.mockResolvedValue({ candidates: [{ finishReason: "STOP" }], text });
    await expect(geminiProvider.extract("A sufficiently long statement.", new AbortController().signal)).rejects.toThrow("INVALID_AI_RESPONSE");
  });
  it("rejects truncation even if JSON looks complete", async () => {
    generate.mockResolvedValue({ candidates: [{ finishReason: "MAX_TOKENS" }], text: '{"claims":[]}' });
    await expect(geminiProvider.extract("A sufficiently long statement.", new AbortController().signal)).rejects.toThrow("INVALID_AI_RESPONSE");
  });
  it("never exposes upstream errors", async () => {
    generate.mockRejectedValue(new Error("test-only-key and private text"));
    await expect(geminiProvider.extract("A sufficiently long statement.", new AbortController().signal)).rejects.toThrow("AI_UNAVAILABLE");
  });
});
