// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/health/route";
const { checkCorpus } = vi.hoisted(() => ({ checkCorpus: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/evidence/providers/local-sahihayn", () => ({ checkSahihaynCorpus: checkCorpus }));
afterEach(() => { vi.unstubAllEnvs(); checkCorpus.mockResolvedValue(undefined); });
describe("safe health readiness", () => {
  it("reports configuration and verified local corpus without probing external services", async () => {
    vi.stubEnv("AI_PROVIDER", "groq"); vi.stubEnv("GROQ_API_KEY", "private-test-value");
    const response = await GET(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready", checks: { aiConfigured: true, localCorpus: true }, externalServicesProbed: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("fails readiness safely if the key or corpus is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", ""); checkCorpus.mockRejectedValue(new Error("private path"));
    const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/private|GROQ_API_KEY|path/);
  });
});
