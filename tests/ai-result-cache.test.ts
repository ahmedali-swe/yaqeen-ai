// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiResultCache, aiRequestKey } from "../src/ai/result-cache";
import { ExtractionError } from "../src/ai/errors";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("bounded process-local AI result store", () => {
  it("deduplicates in-flight requests and returns independent copies", async () => {
    const cache = new AiResultCache(); let resolve!: (value: { text: string }) => void;
    const task = vi.fn(() => new Promise<{ text: string }>((done) => { resolve = done; }));
    const first = cache.run("same", task), second = cache.run("same", task); await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1); resolve({ text: "original" });
    const [a, b] = await Promise.all([first, second]); a.text = "changed";
    expect(b.text).toBe("original"); expect(await cache.run("same", task)).toEqual({ text: "original" }); expect(task).toHaveBeenCalledTimes(1);
  });
  it("expires a successful cache entry at ten minutes", async () => {
    vi.useFakeTimers(); const cache = new AiResultCache(), task = vi.fn(async () => ({ text: "ok" }));
    await cache.run("key", task); await vi.advanceTimersByTimeAsync(599_999); await cache.run("key", task); expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await cache.run("key", task); expect(task).toHaveBeenCalledTimes(2);
  });
  it("never stores an output containing a configured server credential", async () => {
    vi.stubEnv("GROQ_API_KEY", "server-only-test-secret");
    const cache = new AiResultCache(), task = vi.fn(async () => ({ text: "server-only-test-secret" }));
    await cache.run("key", task); await cache.run("key", task); expect(task).toHaveBeenCalledTimes(2);
  });
  it.each(["AI_UNAVAILABLE", "INVALID_AI_RESPONSE"] as const)("does not cache %s", async (code) => {
    const cache = new AiResultCache(), task = vi.fn().mockRejectedValueOnce(new ExtractionError(code)).mockResolvedValue({ text: "ok" });
    await expect(cache.run("key", task)).rejects.toMatchObject({ code }); await cache.run("key", task); await cache.run("key", task); expect(task).toHaveBeenCalledTimes(2);
  });
  it("evicts least recently used entries and skips oversized results", async () => {
    const cache = new AiResultCache({ ttlMs: 600_000, maxEntries: 2, maxBytes: 80, maxEntryBytes: 40, maxPending: 2 });
    const task = vi.fn(async () => ({ text: "ok" }));
    await cache.run("a", task); await cache.run("b", task); await cache.run("a", task); await cache.run("c", task); await cache.run("b", task); expect(task).toHaveBeenCalledTimes(4);
    const huge = vi.fn(async () => ({ text: "x".repeat(100) })); await cache.run("huge", huge); await cache.run("huge", huge); expect(huge).toHaveBeenCalledTimes(2);
  });
  it("does not let one cancelled subscriber abort another", async () => {
    const cache = new AiResultCache(), first = new AbortController(); let resolve!: (value: string) => void, sharedSignal!: AbortSignal;
    const task = vi.fn((signal: AbortSignal) => { sharedSignal = signal; return new Promise<string>((done) => { resolve = done; }); });
    const a = cache.run("key", task, first.signal), b = cache.run("key", task); const rejected = expect(a).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await Promise.resolve(); first.abort(); await rejected; expect(sharedSignal.aborted).toBe(false); resolve("ok"); expect(await b).toBe("ok");
  });
  it("aborts when all subscribers leave and never caches abandoned work", async () => {
    const cache = new AiResultCache(), controller = new AbortController(); let resolve!: (value: string) => void, sharedSignal!: AbortSignal;
    const work = cache.run("key", (signal) => { sharedSignal = signal; return new Promise<string>((done) => { resolve = done; }); }, controller.signal);
    const rejected = expect(work).rejects.toMatchObject({ code: "AI_TIMEOUT" }); await Promise.resolve(); controller.abort(); await rejected;
    expect(sharedSignal.aborted).toBe(true); resolve("abandoned"); await Promise.resolve();
    expect(await cache.run("key", async () => "fresh")).toBe("fresh");
  });
  it("bypasses cache reads and writes for independent live evaluations", async () => {
    const cache = new AiResultCache(), task = vi.fn(async () => "fresh");
    await cache.run("key", async () => "cached"); await cache.run("key", task, undefined, { cache: false }); await cache.run("key", task, undefined, { cache: false });
    expect(task).toHaveBeenCalledTimes(2); expect(await cache.run("key", task)).toBe("cached");
  });
  it("binds operation, model, exact wording/offsets and source fingerprints", () => {
    const input = { claim: { text: "some  text", originalStart: 1 }, evidence: [{ id: "source-1", exactText: "original", metadata: { reference: "1" } }] };
    const key = aiRequestKey("relation", "model-1", input);
    expect(key).toMatch(/^[a-f0-9]{64}$/); expect(key).not.toContain("some");
    expect(aiRequestKey("relation", "model-1", { evidence: input.evidence, claim: input.claim })).toBe(key);
    for (const other of [aiRequestKey("patch", "model-1", input), aiRequestKey("relation", "model-2", input), aiRequestKey("relation", "model-1", { ...input, claim: { ...input.claim, text: "some text" } }), aiRequestKey("relation", "model-1", { ...input, evidence: [{ ...input.evidence[0], exactText: "changed" }] })]) expect(other).not.toBe(key);
  });
});
