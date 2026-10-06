import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { sharedAiResults } from "../src/ai/result-cache";

vi.mock("server-only", () => ({}));
vi.mock("../src/evidence/explanations/hadeethenc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/evidence/explanations/hadeethenc")>();
  const { fixtureSourceFetch } = await import("./fixtures/hadeethenc-transport");
  const resolver = actual.createHadeethEncResolver({ fetcher: fixtureSourceFetch });
  const resolveApprovedExplanations: typeof actual.resolveApprovedExplanations = async (evidence, hint) => {
    const results = await Promise.all(evidence.filter((item) => item.sourceType === "HADITH").map((item) => resolver.resolve(item, hint)));
    const explanations = results.flatMap((result) => result.explanation ? [result.explanation] : []);
    return { explanations, explanationStatus: explanations.length ? "AVAILABLE" : results.some((result) => result.status === "UNAVAILABLE") ? "UNAVAILABLE" : "NO_APPROVED_EXPLANATION" };
  };
  return { ...actual, resolveApprovedExplanations, withApprovedExplanations: async (result: import("../src/evidence/types").EvidenceResult, hint?: string) => result.evidence.some((item) => item.sourceType === "HADITH") ? { ...result, ...await resolveApprovedExplanations(result.evidence, hint) } : result };
});

afterEach(cleanup);
afterEach(() => sharedAiResults.clear());
afterEach(() => { if (typeof window !== "undefined") window.sessionStorage.clear(); });
