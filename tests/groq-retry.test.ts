// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groqProvider } from "../src/ai/providers/groq";
import { GROQ_MAX_RETRY_WAIT_MS, retryAfterMs } from "../src/ai/providers/groq-retry";

const completion = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"claims":[]}' } }] });
const request = (signal = new AbortController().signal) => groqProvider.extract("A sufficiently long statement.", signal);
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("GROQ_API_KEY", "test-only-key"); vi.stubGlobal("fetch", vi.fn()); vi.spyOn(Math, "random").mockReturnValue(0.5); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("shared bounded Groq retries", () => {
  it.each([429, 502, 503, 504])("retries HTTP %s then succeeds", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("never logged", { status })).mockResolvedValueOnce(completion());
    const result = request(); await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toEqual({ claims: [] }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("exhausts repeated 429 after exactly three requests with exponential jitter", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("private", { status: 429 }));
    const rejected = expect(request()).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(624); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_125); await rejected; expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("honors Retry-After seconds without calling early", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "2" } })).mockResolvedValueOnce(completion());
    const result = request(); await vi.advanceTimersByTimeAsync(1_999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await result; expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("honors HTTP-date Retry-After", async () => {
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503, headers: { "Retry-After": "Mon, 05 Oct 2026 00:00:03 GMT" } })).mockResolvedValueOnce(completion());
    const result = request(); await vi.advanceTimersByTimeAsync(2_999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await result; expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("declines a Retry-After beyond the wait budget rather than retrying early", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    await expect(request()).rejects.toMatchObject({ code: "AI_UNAVAILABLE" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("caps aggregate wait even when each individual delay fits", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 429, headers: { "Retry-After": "6" } }));
    const result = expect(request()).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(GROQ_MAX_RETRY_WAIT_MS); await result; expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 404, 413, 422, 500])("does not retry HTTP %s", async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response("private", { status }));
    await expect(request()).rejects.toMatchObject({ code: "AI_UNAVAILABLE" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry malformed structured output", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] }));
    await expect(request()).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("aborts during backoff and makes no later request", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "2" } }));
    const controller = new AbortController(), rejected = expect(request(controller.signal)).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await rejected;
    await vi.advanceTimersByTimeAsync(5_000); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry network exceptions", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("private")); await expect(request()).rejects.toMatchObject({ code: "AI_UNAVAILABLE" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("parses empty/invalid headers conservatively", () => {
    expect(retryAfterMs(null)).toBeNull(); expect(retryAfterMs("nonsense")).toBeNull(); expect(retryAfterMs("0")).toBe(0); expect(retryAfterMs("1.5")).toBe(1_500);
  });
});
