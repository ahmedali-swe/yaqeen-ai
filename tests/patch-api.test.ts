// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/analyze/patch/route";
import { ExtractionError } from "../src/ai/errors";
import { quotationInput, relation } from "./fixtures/relation";

const { generate, reserve, release } = vi.hoisted(() => ({ generate: vi.fn(), reserve: vi.fn(), release: vi.fn() }));
vi.mock("../src/ai/yaqeen-patch", () => ({ generateYaqeenPatch: generate }));
vi.mock("../src/ai/request-limit", () => ({ reserveExtraction: reserve }));
const input = { ...quotationInput, analysis: relation() };
function request(body: unknown = input, headers: Record<string, string> = {}) {
  return new Request("https://yaqeen.example/api/analyze/patch", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => { generate.mockReset(); reserve.mockReset().mockReturnValue(release); release.mockReset(); });
describe("POST /api/analyze/patch", () => {
  it("returns the structured result with no caching and forwards request cancellation", async () => {
    const result = { patch: { action: "NO_SAFE_PATCH" } }; generate.mockResolvedValue(result);
    const response = await POST(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(generate).toHaveBeenCalledWith(input, undefined, expect.any(AbortSignal)); expect(release).toHaveBeenCalledOnce();
  });
  it.each([{}, { ...input, analysis: {} }, { ...input, analysis: { ...input.analysis, strongestEvidenceId: "forged" } }, { ...input, extra: true }])("rejects malformed input before invoking paid AI", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(generate).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
  });
  it("rejects cross-origin input, non-JSON and oversized bodies", async () => {
    expect((await POST(request(input, { Origin: "https://other.example" }))).status).toBe(403);
    expect((await POST(request(input, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ text: "x".repeat(1024 * 1024 + 1) }))).status).toBe(413);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([["AI_NOT_CONFIGURED", 503], ["AI_TIMEOUT", 504], ["AI_UNAVAILABLE", 502], ["INVALID_AI_RESPONSE", 502]] as const)("sanitizes %s", async (code, status) => {
    generate.mockRejectedValue(new ExtractionError(code)); const response = await POST(request());
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: { code } }); expect(release).toHaveBeenCalledOnce();
  });
  it("does not expose provider secrets or create a patch after failure", async () => {
    generate.mockRejectedValue(new Error("private secret text")); const response = await POST(request());
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("private");
    reserve.mockReturnValue(null); const limited = await POST(request()); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
  });
});
