// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groqProvider } from "../src/ai/providers/groq";
import { parseEnv, requireGroqEnv } from "../src/lib/env";
import { claim } from "./fixtures/claims";

const input = "Paris is the capital of France.";
const completion = (content = JSON.stringify({ claims: [claim(input)] }), finish_reason = "stop") => Response.json({ choices: [{ finish_reason, message: { content } }] });
beforeEach(() => { vi.stubEnv("GROQ_API_KEY", "test-only-key"); vi.stubEnv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Groq strict structured-output adapter", () => {
  it("uses strict JSON Schema with all fields required and closed objects", async () => {
    vi.mocked(fetch).mockResolvedValue(completion());
    expect(await groqProvider.extract(input, new AbortController().signal)).toEqual({ claims: [claim(input)] });
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(request?.headers).toEqual({ Authorization: "Bearer test-only-key", "Content-Type": "application/json" });
    const body = JSON.parse(request?.body as string);
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.response_format.type).toBe("json_schema"); expect(body.response_format.json_schema.strict).toBe(true);
    const schema = body.response_format.json_schema.schema;
    expect(schema.additionalProperties).toBe(false); expect(schema.required).toEqual(["claims"]);
    const item = schema.properties.claims.items;
    expect(item.additionalProperties).toBe(false); expect(new Set(item.required)).toEqual(new Set(Object.keys(item.properties)));
    expect(item.properties.claimType.enum).toContain("QUOTE"); expect(item.properties.claimType.enum).toContain("INTERPRETATION");
    expect(item.properties.subject.anyOf).toContainEqual({ type: "null" });
    expect(body.messages[1]).toEqual({ role: "user", content: input });
    expect(body.messages[0].role).toBe("system"); expect(body.tools).toBeUndefined();
    expect(request?.cache).toBe("no-store"); expect(request?.redirect).toBe("error");
  });
  it("allows startup without a Groq key but requires one on invocation", async () => {
    vi.stubEnv("GROQ_API_KEY", ""); expect(() => parseEnv({})).not.toThrow();
    await expect(groqProvider.extract(input, new AbortController().signal)).rejects.toThrow("AI_NOT_CONFIGURED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("defaults the model and rejects an unapproved strict-output model", () => {
    expect(requireGroqEnv({ GROQ_API_KEY: "test" }).GROQ_TEXT_MODEL).toBe("openai/gpt-oss-120b");
    expect(() => requireGroqEnv({ GROQ_API_KEY: "test", GROQ_TEXT_MODEL: "unsupported" })).toThrow("AI_NOT_CONFIGURED");
  });
  it.each([401, 403, 429, 500])("sanitizes provider HTTP %s", async (status) => {
    vi.stubEnv("NODE_ENV", "development"); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: { message: "test-only-key and private input" } }, { status, headers: { "Retry-After": "60" } }));
    await expect(groqProvider.extract(input, new AbortController().signal)).rejects.toThrow("AI_UNAVAILABLE");
    expect(log).toHaveBeenCalledExactlyOnceWith("[Yaqeen: Groq request failed]", { status, attempt: 1, retrying: false });
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-only-key");
  });
  it("keeps production diagnostics silent", async () => {
    vi.stubEnv("NODE_ENV", "production"); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(Response.json({}, { status: 401 }));
    await expect(groqProvider.extract(input, new AbortController().signal)).rejects.toThrow("AI_UNAVAILABLE");
    expect(log).not.toHaveBeenCalled();
  });
  it.each([{}, { choices: [] }, { choices: [{ finish_reason: "length", message: { content: '{"claims":[]}' } }] }, { choices: [{ finish_reason: "stop", message: { content: '{"claims":[]}', refusal: "refused" } }] }])("rejects invalid, truncated or refused completions %j", async (raw) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(raw));
    await expect(groqProvider.extract(input, new AbortController().signal)).rejects.toThrow("INVALID_AI_RESPONSE");
  });
  it.each(["not JSON", "```json\n{\"claims\":[]}\n```"])("does not repair free-form output: %s", async (content) => {
    vi.mocked(fetch).mockResolvedValue(completion(content));
    await expect(groqProvider.extract(input, new AbortController().signal)).rejects.toThrow("INVALID_AI_RESPONSE");
  });
  it("maps cancellation to timeout without exposing an exception", async () => {
    const controller = new AbortController(); controller.abort();
    vi.mocked(fetch).mockRejectedValue(new Error("private transport diagnostics"));
    await expect(groqProvider.extract(input, controller.signal)).rejects.toThrow("AI_TIMEOUT");
  });
  it("sanitizes network failures", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("private transport diagnostics"));
    await expect(groqProvider.extract(input, new AbortController().signal)).rejects.toThrow("AI_UNAVAILABLE");
  });
});
