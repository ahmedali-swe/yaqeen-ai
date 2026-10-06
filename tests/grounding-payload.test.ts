// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { boundedContext, explanationSegments, groundingPayload, selectExplanation, strongestEvidence, GroundingBudgetError, MAX_EXPLANATION_CHARACTERS, MAX_SURROUNDING_CHARACTERS } from "../src/ai/grounding-payload";
import { prepareGroundingRequest, serializeGroqRequest, requestMeasurements, MAX_GROQ_GROUNDING_REQUEST_BYTES } from "../src/ai/groq-request";
import { groqReasoningProvider } from "../src/ai/providers/groq-reasoning";
import { groqPatchProvider } from "../src/ai/providers/groq-patch";
import { analyzeEvidenceRelation } from "../src/ai/evidence-reasoning";
import { generateYaqeenPatch } from "../src/ai/yaqeen-patch";
import * as explanations from "../src/evidence/explanations/hadeethenc";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { type EvidenceCandidate } from "../src/evidence/types";
import { quotationInput, relation } from "./fixtures/relation";
import { bukhari71Content, bukhari71Quote, bukhari71Conclusion } from "./fixtures/bukhari-71";
import { claim } from "./fixtures/claims";

let b71: EvidenceCandidate;
beforeAll(async () => { b71 = (await localSahihaynProvider.retrieve(bukhari71Quote, new AbortController().signal)).find(item => item.id === "sahihayn-bukhari-71")!; });
beforeEach(() => { vi.stubEnv("GROQ_API_KEY", "test-secret-never-log"); vi.stubEnv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const completion = (result: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] });
const request = (input: unknown, instructions = "instructions") => ({ instructions, input: JSON.stringify(input), schemaName: "test", schema: { type: "object" } });
const signal = () => new AbortController().signal;
const analysis = () => relation({ strongestEvidenceId: b71.id, verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: bukhari71Conclusion.text });
async function b71Input() {
  return { claim: bukhari71Conclusion, evidence: [b71], originalContent: bukhari71Content, approvedExplanations: (await explanations.resolveApprovedExplanations([b71])).explanations };
}

it("uses score ranking with stable adapter ties without mutating secondary sources", () => {
  const first = quotationInput.evidence[0];
  const input = { ...quotationInput, evidence: [{ ...first, id: "z", relevanceScore: 0.5 }, { ...first, id: "a" }, { ...first, id: "b" }] };
  const before = JSON.stringify(input);
  expect(strongestEvidence(input).id).toBe("a"); expect(groundingPayload(input).evidence.map(item => item.id)).toEqual(["a"]);
  expect(JSON.stringify(input)).toBe(before); expect(input.evidence).toHaveLength(3);
  const tied = { ...input, evidence: [input.evidence[2], input.evidence[1]] };
  expect(strongestEvidence(tied).id).toBe("b");
});
it("honors a validated explicit context ID over another candidate's score", () => {
  const evidence = quotationInput.evidence[0];
  const input = { ...quotationInput, claim: claim("هذا الحديث يعني أن الراحة شرط", { claimType: "INTERPRETATION" }), evidence: [{ ...evidence, id: "unrelated", exactText: "نص آخر غير مرتبط", relevanceScore: 1 }, evidence] };
  expect(strongestEvidence(input).id).toBe(evidence.id);
});
it("sends only one source and one explanation, no hints/URLs/raw metadata/duplicate claim or hadith", async () => {
  const input = await b71Input();
  input.evidence.push({ ...b71, id: "secondary", exactText: "SECONDARY_ONLY", relevanceScore: 0.1, metadata: { raw: "RAW_ONLY" } });
  const before = JSON.stringify(input); vi.mocked(fetch).mockResolvedValue(completion({ analysis: analysis() }));
  await groqReasoningProvider.analyze(input, signal());
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string), payload = JSON.parse(body.messages[1].content);
  expect(payload.evidence).toHaveLength(1); expect(payload.approvedExplanations).toHaveLength(1);
  expect(body.messages[1].content).not.toMatch(/SECONDARY_ONLY|RAW_ONLY|canonicalUrl|apiUrl|hints|words_meanings|normalizedText|verificationReason|exactHadithText|metadata|originalClaim"/);
  expect(payload.evidence[0].exactText).toBe(b71.exactText);
  expect(payload.approvedExplanations[0]).toMatchObject({ sourceId: "5518", reference: input.approvedExplanations[0].reference });
  expect(fetch).toHaveBeenCalledOnce(); expect(JSON.stringify(input)).toBe(before);
});
it("preserves a short explanation in full without sending it twice", async () => {
  const explanation = (await b71Input()).approvedExplanations[0];
  const selected = selectExplanation(explanation, bukhari71Conclusion.text, b71.exactText);
  expect(selected.selection).toBe("FULL"); expect(selected.segments).toEqual([{ text: explanation.exactExplanation, start: 0, end: explanation.exactExplanation.length }]);
});
it("segments/ranks long Arabic text deterministically with verbatim whole-sentence offsets", async () => {
  const explanation = (await b71Input()).approvedExplanations[0];
  const filler = "هذا مقطع تجريبي غير مرتبط عن السفر والطعام والملابس والمسافات.\n".repeat(80);
  const text = filler + "الفقه فهم الدين والعلم الشرعي.\n" + "لكن الفهم لا يشترط التخصص الدراسي في الفقه.\n" + "التخصص الدراسي موضوع مستقل يحتاج إلى بحث.\n";
  const source = { ...explanation, exactExplanation: text };
  const one = selectExplanation(source, bukhari71Conclusion.text, b71.exactText), two = selectExplanation(source, bukhari71Conclusion.text, b71.exactText);
  expect(one).toEqual(two); expect(one.selection).toBe("EXCERPTS"); expect(one.segments.length).toBeGreaterThanOrEqual(2); expect(one.segments.length).toBeLessThanOrEqual(4);
  expect(one.segments.reduce((sum, segment) => sum + segment.text.length, 0)).toBeLessThanOrEqual(MAX_EXPLANATION_CHARACTERS);
  for (const segment of one.segments) { expect(text.slice(segment.start, segment.end)).toBe(segment.text); expect(segment.text.trim()).toMatch(/[.!?؟]$/u); }
  expect(one.segments.some(segment => segment.text.includes("لا يشترط"))).toBe(true);
  expect(source.exactExplanation).toBe(text);
});
it("does not slice an oversized necessary sentence", async () => {
  const explanation = (await b71Input()).approvedExplanations[0];
  expect(() => selectExplanation({ ...explanation, exactExplanation: "الفقه والعلم الشرعي ".repeat(400) + "." }, bukhari71Conclusion.text, b71.exactText)).toThrow(GroundingBudgetError);
});
it("abstains if necessary qualifying segments exceed the segment bound", async () => {
  const explanation = (await b71Input()).approvedExplanations[0];
  const text = "الفقه والعلم الشرعي لا يشترط التخصص الدراسي.\n".repeat(100);
  expect(() => selectExplanation({ ...explanation, exactExplanation: text }, bukhari71Conclusion.text, b71.exactText)).toThrow(GroundingBudgetError);
});
it("retains sentence delimiters and original paragraph whitespace", () => {
  const text = "  الجملة الأولى.\nالجملة الثانية؟\n\nالجملة الأخيرة بلا نقطة";
  for (const segment of explanationSegments(text)) expect(text.slice(segment.start, segment.end)).toBe(segment.text);
  expect(explanationSegments(text).map(segment => segment.text).join("")).toBe(text);
});
it("bounds a long article around validated claim offsets while preserving the explicit anchor/connector", () => {
  const prefix = "مادة غير مرتبطة. ".repeat(250), suffix = " تفاصيل بعيدة.".repeat(250), content = prefix + bukhari71Content + suffix;
  const input = { claim: { ...bukhari71Conclusion, originalStart: bukhari71Conclusion.originalStart! + prefix.length, originalEnd: bukhari71Conclusion.originalEnd! + prefix.length }, evidence: [b71], originalContent: content };
  const context = boundedContext(input, b71);
  expect(context.originalContent!.length).toBeLessThanOrEqual(MAX_SURROUNDING_CHARACTERS);
  expect(context.originalContent).toContain(bukhari71Conclusion.text);
  expect(context.contextualAnchor).toMatchObject({ evidenceId: b71.id, text: bukhari71Quote.text });
  expect(context.contextualAnchor!.connector).toContain("ثم استنتج أن");
  expect(content.slice(context.contextualAnchor!.originalStart, context.contextualAnchor!.originalEnd)).toBe(context.contextualAnchor!.text);
});
it("does not invent context from invalid offsets or unrelated adjacent claims", () => {
  expect(boundedContext({ ...quotationInput, claim: { ...quotationInput.claim, originalStart: 500, originalEnd: 520 } }, quotationInput.evidence[0])).toEqual({ originalContent: null, contextualAnchor: null });
  const text = "الحافلة تصل الساعة العاشرة", content = bukhari71Quote.text + "، ثم وصلت الحافلة. " + text;
  expect(boundedContext({ claim: claim(text), evidence: [b71], originalContent: content }, b71).contextualAnchor).toBeNull();
});
it("budgets the complete serialized request including schema/prompt and UTF-8 escaping", () => {
  const options = request({ claim: { text: "نص عربي" }, evidence: [{ exactText: "دليل كامل" }], originalContent: null }, "prompt".repeat(4000));
  expect(Buffer.byteLength(serializeGroqRequest(options, "openai/gpt-oss-120b"))).toBeGreaterThan(MAX_GROQ_GROUNDING_REQUEST_BYTES);
  expect(() => prepareGroundingRequest(options, "openai/gpt-oss-120b")).toThrow(GroundingBudgetError);
});
it("drops only optional surrounding prose before refusing a request; keeps anchor/proof/claim verbatim", () => {
  const input = { claim: { text: "الادعاء" }, evidence: [{ exactText: "الدليل" }], approvedExplanations: [{ segments: [{ text: "شرح معتمد" }] }], contextualAnchor: { text: "المقتبس", connector: "ثم استنتج أن" }, originalContent: "مادة غير مرتبطة ".repeat(2000) };
  const serialized = prepareGroundingRequest(request(input), "openai/gpt-oss-120b"), payload = JSON.parse(JSON.parse(serialized).messages[1].content);
  expect(payload).toEqual({ ...input, originalContent: null }); expect(Buffer.byteLength(serialized)).toBeLessThan(MAX_GROQ_GROUNDING_REQUEST_BYTES);
});
it("never truncates an oversized religious passage and safely returns NEEDS_CONTEXT with zero Groq calls", async () => {
  vi.spyOn(explanations, "resolveApprovedExplanations").mockResolvedValue({ explanations: [], explanationStatus: "NO_APPROVED_EXPLANATION" });
  const exactText = "نص مصدر طويل محفوظ ".repeat(1500), input = { ...quotationInput, evidence: [{ ...quotationInput.evidence[0], exactText }] };
  const result = await analyzeEvidenceRelation(input);
  expect(result.analysis).toMatchObject({ verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: input.evidence[0].id });
  expect(fetch).not.toHaveBeenCalled(); expect(input.evidence[0].exactText).toBe(exactText);
});
it("returns NEEDS_CONTEXT without an AI summarizer when approved explanation cannot fit safely", async () => {
  const input = await b71Input(), approved = { ...input.approvedExplanations[0], exactExplanation: "الفقه والعلم الشرعي ".repeat(400) + "." };
  vi.spyOn(explanations, "resolveApprovedExplanations").mockResolvedValue({ explanations: [approved], explanationStatus: "AVAILABLE" });
  expect((await analyzeEvidenceRelation({ ...input, approvedExplanations: undefined })).analysis.verificationStatus).toBe("NEEDS_CONTEXT");
  expect(fetch).not.toHaveBeenCalled();
});
it("bounds Patch to its previously analyzed strongest source and exact explanation; no extra AI call", async () => {
  const input = await b71Input(), extra = { ...b71, id: "secondary", exactText: "UNRELATED", relevanceScore: 1 };
  vi.mocked(fetch).mockResolvedValue(completion({ patch: {} }));
  await groqPatchProvider.generate({ ...input, evidence: [extra, b71], analysis: analysis() }, signal());
  const serialized = vi.mocked(fetch).mock.calls[0][1]!.body as string, body = JSON.parse(serialized), payload = JSON.parse(body.messages[1].content);
  expect(payload.evidence.map((item: { id: string }) => item.id)).toEqual([b71.id]); expect(payload.analysis).toEqual(analysis());
  expect(payload.contextualAnchor.connector).toContain("ثم استنتج أن"); expect(payload.approvedExplanations[0].sourceId).toBe("5518");
  expect(serialized).not.toContain("UNRELATED"); expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(MAX_GROQ_GROUNDING_REQUEST_BYTES); expect(fetch).toHaveBeenCalledOnce();
});
it("Patch abstains rather than cutting necessary explanation/source grounding", async () => {
  const input = await b71Input(), approved = { ...input.approvedExplanations[0], exactExplanation: "الفقه والعلم الشرعي ".repeat(400) + "." };
  vi.spyOn(explanations, "resolveApprovedExplanations").mockResolvedValue({ explanations: [approved], explanationStatus: "AVAILABLE" });
  expect((await generateYaqeenPatch({ ...input, approvedExplanations: undefined, analysis: analysis() })).patch).toMatchObject({ action: "NO_SAFE_PATCH", proposedText: null, changes: [] });
  expect(fetch).not.toHaveBeenCalled();
});
it("logs size counts only in development, never keys, headers or user/source strings", async () => {
  vi.stubEnv("NODE_ENV", "development"); const log = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(fetch).mockResolvedValue(completion({ analysis: relation() })); await groqReasoningProvider.analyze(quotationInput, signal());
  const logged = JSON.stringify(log.mock.calls); expect(log).toHaveBeenCalledOnce(); expect(logged).not.toContain("test-secret-never-log");
  expect(logged).not.toContain(quotationInput.claim.text); expect(logged).not.toContain("Authorization");
  expect(log.mock.calls[0][1]).toMatchObject({ evidenceCandidates: 1, hints: 0 });
});
it("keeps production size diagnostics silent and measurement includes only counts", async () => {
  vi.stubEnv("NODE_ENV", "production"); const log = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(fetch).mockResolvedValue(completion({ analysis: relation() })); await groqReasoningProvider.analyze(quotationInput, signal()); expect(log).not.toHaveBeenCalled();
  const payload = groundingPayload(quotationInput), options = request(payload), serialized = serializeGroqRequest(options, "openai/gpt-oss-120b");
  expect(requestMeasurements(options, serialized).bytes).toBe(Buffer.byteLength(serialized));
});
