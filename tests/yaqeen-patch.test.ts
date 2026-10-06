// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateYaqeenPatch, type PatchProvider } from "../src/ai/yaqeen-patch";
import { PatchInputSchema, PatchResultSchema, applyPatchChanges, isBoundPatch, minimizePatchEdits, type Patch, type PatchInput } from "../src/domain/yaqeen-patch";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { interpretationClaim, quotationClaim, relation } from "./fixtures/relation";

let input: PatchInput;
const proposal = (): Patch => ({ action: "PATCH", originalText: input.claim.text, proposedText: "الأعمال بالنيات",
  changes: [{ originalSegment: input.claim.text, replacementSegment: "الأعمال بالنيات", mutationType: "UNSUPPORTED_INFERENCE", reason: "حذف شرط الراحة النفسية الذي لا يثبته الحديث." }],
  preservedIntent: "إبقاء الحديث عن صلة الأعمال بالنية دون حكم على قبول عمل شخصي.", evidenceIds: ["sahihayn-bukhari-1"], explanation: "النص يدعم ارتباط الأعمال بالنيات فقط." });
beforeAll(async () => {
  const evidence = await localSahihaynProvider.retrieve(quotationClaim, new AbortController().signal);
  input = { claim: interpretationClaim, evidence, analysis: relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", strongestEvidenceId: evidence[0].id, unsupportedPart: interpretationClaim.text }) };
});
describe("evidence-preserving Yaqeen Patch", () => {
  it("authenticates real local evidence, binds edits and IDs, and keeps caller sources immutable", async () => {
    const before = JSON.stringify(input);
    const generate = vi.fn().mockImplementation(async (snapshot) => {
      expect(Object.isFrozen(snapshot.evidence[0])).toBe(true);
      expect(Object.isFrozen(snapshot.evidence[0].metadata)).toBe(true);
      return { patch: proposal() };
    });
    expect(await generateYaqeenPatch(input, { generate })).toEqual({ patch: proposal() });
    expect(JSON.stringify(input)).toBe(before); expect(generate).toHaveBeenCalledOnce();
  });
  it("does not pass caller-invented narrator or grading to the model", async () => {
    const generate = vi.fn().mockResolvedValue({ patch: proposal() });
    await generateYaqeenPatch({ ...input, evidence: input.evidence.map((item) => ({ ...item, metadata: { ...item.metadata, narrator: "invented", grading: "invented" } })) }, { generate });
    const sent = generate.mock.calls[0][0].evidence[0].metadata;
    expect(sent.narrator).toBeUndefined(); expect(sent.grading).toBeNull();
  });
  it.each(["exactText", "reference", "sourceName", "canonicalUrl"] as const)("abstains when %s is forged despite a valid-looking source ID", async (field) => {
    const generate = vi.fn();
    const evidence = input.evidence.map((item) => ({ ...item, [field]: field === "canonicalUrl" ? "https://sunnah.com/bukhari:71" : "forged" }));
    expect((await generateYaqeenPatch({ ...input, evidence }, { generate })).patch.action).toBe("NO_SAFE_PATCH"); expect(generate).not.toHaveBeenCalled();
  });
  it("abstains without evidence or a proven relation and does not contact AI", async () => {
    const generate = vi.fn();
    const noEvidence = { ...input, evidence: [], analysis: relation({ verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: null }) };
    const result = await generateYaqeenPatch(noEvidence, { generate });
    expect(result.patch).toMatchObject({ action: "NO_SAFE_PATCH", proposedText: null, changes: [], evidenceIds: [] });
    expect(result.patch.explanation).toContain("لا تتوفر أدلة كافية"); expect(generate).not.toHaveBeenCalled();
  });
  it("does not force a correction for a supported claim", async () => {
    const generate = vi.fn();
    const result = await generateYaqeenPatch({ ...input, claim: quotationClaim, analysis: relation({ strongestEvidenceId: input.evidence[0].id }) }, { generate });
    expect(result.patch.action).toBe("NO_SAFE_PATCH"); expect(generate).not.toHaveBeenCalled();
  });
  it("explicitly refers specialist cases without issuing a ruling or contacting AI", async () => {
    const generate = vi.fn();
    const specialist = { ...input, analysis: { ...input.analysis, verificationStatus: "REQUIRES_SPECIALIST" as const, requiresSpecialist: true } };
    expect((await generateYaqeenPatch(specialist, { generate })).patch).toMatchObject({ action: "REFER_SPECIALIST", proposedText: null, changes: [] });
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([
    { evidenceIds: ["invented"] }, { originalText: "rewritten original" }, { proposedText: "unreported rewrite" },
    { changes: [] }, { action: "NO_SAFE_PATCH" }, { evidenceIds: ["sahihayn-bukhari-1", "sahihayn-bukhari-1"] },
    { explanation: "English only" }, { changes: [{ originalSegment: "absent", replacementSegment: null, mutationType: "UNSUPPORTED_INFERENCE", reason: "سبب عربي" }] },
  ])("rejects unsafe or unbound provider output", async (override) => {
    const provider = { generate: vi.fn().mockResolvedValue({ patch: { ...proposal(), ...override } }) };
    await expect(generateYaqeenPatch(input, provider)).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });
  it("rejects malformed output and keeps provider details private", async () => {
    await expect(generateYaqeenPatch(input, { generate: vi.fn().mockResolvedValue({ broken: true }) })).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
    await expect(generateYaqeenPatch(input, { generate: vi.fn().mockRejectedValue(new Error("secret details")) })).rejects.toMatchObject({ code: "AI_UNAVAILABLE", message: "AI_UNAVAILABLE" });
  });
  it("honors cancellation and rejects an inconsistent input analysis", async () => {
    const controller = new AbortController(); controller.abort(); const generate = vi.fn();
    await expect(generateYaqeenPatch(input, { generate }, controller.signal)).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(PatchInputSchema.safeParse({ ...input, analysis: { ...input.analysis, strongestEvidenceId: "unknown" } }).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not start a paid request when cancelled during source authentication", async () => {
    const controller = new AbortController(), generate = vi.fn();
    const pending = generateYaqeenPatch(input, { generate }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("checks exact edit reconstruction, uniqueness and overlap", () => {
    const change = { mutationType: "PARAPHRASE" as const, reason: "سبب" };
    expect(applyPatchChanges("abc xyz", [{ ...change, originalSegment: "abc", replacementSegment: null }])).toBe(" xyz");
    expect(applyPatchChanges("abc abc", [{ ...change, originalSegment: "abc", replacementSegment: "x" }])).toBeNull();
    expect(applyPatchChanges("abc", [{ ...change, originalSegment: "ab", replacementSegment: "x" }, { ...change, originalSegment: "bc", replacementSegment: "y" }])).toBeNull();
  });
  it("reports only the changed proposition when the provider repeats an unaffected reporting frame", () => {
    const text = "هذا الحديث يعني أن الراحة النفسية شرط";
    const selected = { ...input, claim: { ...input.claim, text }, analysis: { ...input.analysis, unsupportedPart: text } };
    const patch = { ...proposal(), originalText: text, proposedText: "هذا الحديث يعني أن الأعمال بالنيات", changes: [{ ...proposal().changes[0], originalSegment: text, replacementSegment: "هذا الحديث يعني أن الأعمال بالنيات" }] };
    const minimized = minimizePatchEdits(patch, selected);
    expect(minimized.changes[0].originalSegment).toBe("الراحة النفسية شرط");
    expect(applyPatchChanges(text, minimized.changes)).toBe(patch.proposedText);
  });
  it("preserves quoted religious wording and rejects creative new religious quotations", () => {
    const claim = { ...input.claim, text: "«إنما الأعمال بالنيات» يعني الراحة النفسية" };
    const contextual = { ...input, claim, analysis: { ...input.analysis, unsupportedPart: "يعني الراحة النفسية" } };
    const patch = { ...proposal(), originalText: claim.text, proposedText: "«إنما الأعمال بالنيات» يرتبط بالنية", changes: [{ ...proposal().changes[0], originalSegment: "يعني الراحة النفسية", replacementSegment: "يرتبط بالنية" }] };
    expect(isBoundPatch(patch, contextual)).toBe(true);
    const bad = { ...patch, proposedText: "«كل عمل مريح مقبول» يرتبط بالنية", changes: [{ ...proposal().changes[0], originalSegment: claim.text, replacementSegment: "«كل عمل مريح مقبول» يرتبط بالنية" }] };
    expect(isBoundPatch(bad, contextual)).toBe(false);
    expect(PatchResultSchema.safeParse({ patch: { ...patch, extra: true } }).success).toBe(false);
  });
  it("abstains from creatively editing an unmarked religious quotation, but permits verbatim supplied wording", async () => {
    const selected = { ...input, claim: { ...input.claim, claimType: "QUOTE" as const } };
    const unsafe = await generateYaqeenPatch(selected, { generate: vi.fn().mockResolvedValue({ patch: proposal() }) });
    expect(unsafe.patch.action).toBe("NO_SAFE_PATCH"); expect(unsafe.patch.proposedText).toBeNull();
    const exactText = input.evidence[0].exactText;
    const exact = { ...proposal(), proposedText: exactText, changes: [{ ...proposal().changes[0], replacementSegment: exactText }] };
    expect((await generateYaqeenPatch(selected, { generate: vi.fn().mockResolvedValue({ patch: exact }) })).patch.action).toBe("PATCH");
  });
  it("permits the provider to abstain rather than forcing an unsafe edit", async () => {
    const provider: PatchProvider = { generate: vi.fn().mockResolvedValue({ patch: { ...proposal(), action: "NO_SAFE_PATCH", proposedText: null, changes: [], evidenceIds: [] } }) };
    expect((await generateYaqeenPatch(input, provider)).patch.action).toBe("NO_SAFE_PATCH");
  });
});
