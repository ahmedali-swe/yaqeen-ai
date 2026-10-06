// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import captures from "./fixtures/dorar-live.json";
import { claim } from "./fixtures/claims";
import { EvidenceResultSchema } from "../src/evidence/types";
// Force a primary miss only in this file to exercise optional live-source paths.
vi.mock("../src/evidence/providers/local-sahihayn", () => ({ localSahihaynProvider: { retrieve: async () => [] } }));

const state = globalThis as typeof globalThis & { evidenceBudget?: { starts: number[]; active: number } };
beforeEach(() => { vi.resetModules(); state.evidenceBudget = { starts: [], active: 0 }; });
afterEach(() => vi.unstubAllGlobals());
const request = () => new Request("http://localhost:3000/api/analyze/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim: claim(captures[0].query, { claimType: "QUOTE" }) }) });

it("runs optional Dorar after a primary miss through the real retriever/provider/parser", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(url.startsWith("https://dorar.net/") ? captures[0].response : { items: [] }))));
  const { POST } = await import("../src/app/api/analyze/evidence/route");
  const response = await POST(request()); expect(response.status).toBe(200);
  const { evidence } = EvidenceResultSchema.parse(await response.json());
  expect(evidence).toHaveLength(5);
  expect(evidence.every((item) => item.id.startsWith("dorar-api-") && item.canonicalUrl === null)).toBe(true);
  expect(evidence[0].metadata.provider).toBe("dorar");
  expect(evidence[0].metadata.retrievalRole).toBe("DORAR_CROSSCHECK");
  expect(evidence[0]).not.toHaveProperty("verificationStatus");
});

it.each([403, 503])("discloses optional Dorar HTTP %s with an honest empty primary-corpus result", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(url.startsWith("https://dorar.net/") ? new Response("private Cloudflare body", { status }) : Response.json({ items: [] }))));
  const { POST } = await import("../src/app/api/analyze/evidence/route");
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ evidence: [], retrieval: { hadithCorpus: "SAHIHAYN", hadith: "NO_LOCAL_MATCH", dorar: "UNAVAILABLE", quranpedia: "AVAILABLE" } });
});

it("discloses an optional source failure for unparseable official JSON without fabricating evidence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(url.startsWith("https://dorar.net/") ? { ahadith: [{ th: "<html>private error</html>" }] } : { items: [] }))));
  const { POST } = await import("../src/app/api/analyze/evidence/route");
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ evidence: [], retrieval: { hadithCorpus: "SAHIHAYN", hadith: "NO_LOCAL_MATCH", dorar: "UNAVAILABLE", quranpedia: "AVAILABLE" } });
});
