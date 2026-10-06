import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { YaqeenPatchAction } from "../src/components/yaqeen-patch";
import { MeaningChange } from "../src/components/relation-analysis";
import { EvidenceCard } from "../src/components/evidence-card";
import { localSahihaynProvider } from "../src/evidence/providers/local-sahihayn";
import { resolveApprovedExplanations } from "../src/evidence/explanations/hadeethenc";
import type { EvidenceCandidate } from "../src/evidence/types";
import type { EvidenceExplanation } from "../src/evidence/explanations/types";
import type { Patch } from "../src/domain/yaqeen-patch";
import { quotationClaim, interpretationClaim, hadithEvidence, relation } from "./fixtures/relation";
import { bukhari71Quote, bukhari71Conclusion } from "./fixtures/bukhari-71";

let b71: EvidenceCandidate, explanation: EvidenceExplanation;
beforeAll(async () => {
  b71 = (await localSahihaynProvider.retrieve(bukhari71Quote, new AbortController().signal)).find(item => item.id === "sahihayn-bukhari-71")!;
  explanation = (await resolveApprovedExplanations([b71], bukhari71Quote.text)).explanations[0];
});
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const supported = { claim: quotationClaim, evidence: [hadithEvidence], analysis: relation() };
const unsupported = { claim: interpretationClaim, evidence: [hadithEvidence], analysis: relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: interpretationClaim.text }) };
const noChange: Patch = { action: "NO_SAFE_PATCH", originalText: quotationClaim.text, proposedText: null, changes: [], evidenceIds: [], explanation: "الادعاء أمين للأدلة المقدمة؛ لا يحتاج إلى تصحيح يقين.", preservedIntent: "حُفظ النص كما ورد." };
const correction: Patch = { action: "PATCH", originalText: interpretationClaim.text, proposedText: "الأعمال بالنيات", changes: [{ originalSegment: interpretationClaim.text, replacementSegment: "الأعمال بالنيات", mutationType: "UNSUPPORTED_INFERENCE", reason: "إزالة الشرط غير المدعوم." }], preservedIntent: "بيان صلة العمل بالنية.", evidenceIds: [hadithEvidence.id], explanation: "الدليل يربط الأعمال بالنيات." };

it.each([undefined, noChange])("renders a supported quote's valid no-change state with zero requests, whether or not Patch was stored", initialPatch => {
  const onRestart = vi.fn(), onPatchChange = vi.fn(), before = JSON.stringify({ supported, initialPatch });
  const view = render(<YaqeenPatchAction trace={supported} initialPatch={initialPatch} onRestart={onRestart} onPatchChange={onPatchChange} />);
  expect(screen.getByRole("heading", { name: "لا يحتاج إلى تصحيح" })).toBeInTheDocument();
  expect(screen.getByText("الاقتباس أمين للنص المعروض ولا يتطلب تعديلًا.")).toBeInTheDocument();
  expect(screen.queryByText("تعذر اقتراح تصحيح موثوق")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  view.rerender(<YaqeenPatchAction trace={supported} initialPatch={initialPatch} onRestart={onRestart} onPatchChange={onPatchChange} />);
  expect(fetch).not.toHaveBeenCalled(); expect(onRestart).not.toHaveBeenCalled(); expect(onPatchChange).not.toHaveBeenCalled();
  expect(JSON.stringify({ supported, initialPatch })).toBe(before);
});
it("uses content copy for an already faithful paraphrase without another AI call", () => {
  render(<YaqeenPatchAction trace={{ ...supported, analysis: relation({ relationType: "PARAPHRASE" }) }} onRestart={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "لا يحتاج إلى تصحيح" })).toBeInTheDocument();
  expect(screen.getByText("المحتوى أمين للمعنى المعروض ولا يتطلب تعديلًا.")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
it("keeps a technical failure's explicit retry and makes exactly the requested retry call", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "AI_UNAVAILABLE" } }, { status: 502 })).mockResolvedValueOnce(Response.json({ patch: correction }));
  const user = userEvent.setup(); render(<YaqeenPatchAction trace={unsupported} />);
  await user.click(screen.getByRole("button", { name: "اقتراح تصحيح يقين" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
  expect(await screen.findByRole("heading", { name: "بعد" })).toBeInTheDocument(); expect(fetch).toHaveBeenCalledTimes(2);
});
it("keeps meaningful explicit Patch re-analysis for an existing correction", async () => {
  const onRestart = vi.fn(), user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ patch: correction }));
  render(<YaqeenPatchAction trace={unsupported} initialPatch={correction} onRestart={onRestart} />);
  expect(fetch).not.toHaveBeenCalled(); await user.click(screen.getByRole("button", { name: "إعادة إعداد تصحيح يقين" }));
  await screen.findByRole("heading", { name: "بعد" }); expect(onRestart).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
});
it("separates Bukhari 71's grounded meaning and secondary provenance without changing stored analysis", () => {
  const analysis = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", strongestEvidenceId: b71.id, unsupportedPart: bukhari71Conclusion.text, supportedMeaning: "لا يوجد معنى مدعوم من النص" });
  const before = JSON.stringify({ analysis, b71, explanation });
  render(<MeaningChange analysis={analysis} hasExplanation strongestEvidence={b71} approvedExplanation={explanation} />);
  const summary = screen.getByText("يدل الحديث على ارتباط إرادة الخير بالتفقه في الدين.");
  const note = screen.getByText("خلاصة يقين مبنية على الدليل والشرح المعتمد، وليست اقتباسًا من نص الشرح.");
  expect(summary.tagName).toBe("SPAN"); expect(summary).not.toContainElement(note);
  expect(note.closest("p")).toHaveClass("evidence-help"); expect(note.closest("blockquote")).toBeNull();
  expect(screen.queryByText(/تحليل يقين استنادًا إلى النص والشرح المعتمد/)).not.toBeInTheDocument();
  expect(JSON.stringify({ analysis, b71, explanation })).toBe(before); expect(fetch).not.toHaveBeenCalled();
});
it("uses the simpler matched-quotation summary while retaining a separate provenance note", () => {
  render(<MeaningChange analysis={relation()} strongestEvidence={hadithEvidence} />);
  expect(screen.getByText("الاقتباس مطابق للنص الوارد في الحديث.")).toBeInTheDocument();
  expect(screen.getByText("خلاصة يقين مبنية على الدليل المعروض، وليست اقتباسًا من نص المصدر.").closest("p")).toHaveClass("evidence-help");
  expect(fetch).not.toHaveBeenCalled();
});
it("does not substitute the Bukhari explanation copy for an unbound source", () => {
  const analysis = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", strongestEvidenceId: b71.id, unsupportedPart: bukhari71Conclusion.text });
  render(<MeaningChange analysis={analysis} hasExplanation strongestEvidence={b71} approvedExplanation={{ ...explanation, evidenceId: "different-evidence" }} />);
  expect(screen.getByText(analysis.supportedMeaning)).toBeInTheDocument();
  expect(screen.queryByText("يدل الحديث على ارتباط إرادة الخير بالتفقه في الدين.")).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
it("keeps the Patch reason concise while preserving diff, intent, internal provenance and full Evidence explanation", async () => {
  const analysis = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", strongestEvidenceId: b71.id, unsupportedPart: bukhari71Conclusion.text });
  const trace = { claim: bukhari71Conclusion, evidence: [b71], approvedExplanations: [explanation], analysis };
  const patch: Patch = { ...correction, originalText: bukhari71Conclusion.text, proposedText: `لا يكفي هذا الحديث للاستدلال على أن ${bukhari71Conclusion.text}`, evidenceIds: [b71.id], explanation: explanation.exactExplanation,
    changes: [{ originalSegment: "كل", replacementSegment: "لا يكفي هذا الحديث للاستدلال على أن كل", mutationType: "UNSUPPORTED_INFERENCE", reason: explanation.exactExplanation }] };
  const before = JSON.stringify({ trace, patch }), user = userEvent.setup();
  const view = render(<><YaqeenPatchAction trace={trace} initialPatch={patch} /><EvidenceCard evidence={b71} explanation={explanation} /></>);
  const reason = screen.getByText("لماذا تغير؟").parentElement!.querySelector("dd")!;
  expect(reason).toHaveTextContent("لأن الدليل والشرح المعتمد لا يثبتان الاستنتاج العكسي الوارد في النص."); expect(reason.textContent!.length).toBeLessThan(100);
  const panel = view.container.querySelector(".patch-panel")!;
  expect(panel.textContent).not.toContain(explanation.exactExplanation); expect(screen.getByText(patch.preservedIntent)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "قبل" }).parentElement!.querySelector("blockquote")!.textContent).toBe(patch.originalText);
  expect(screen.getByRole("heading", { name: "بعد" }).parentElement!.querySelector("blockquote")!.textContent).toBe(patch.proposedText);
  await user.click(screen.getByText("الشرح المعتمد")); await user.click(screen.getByText("عرض الشرح كاملًا"));
  const full = view.container.querySelector(".approved-explanation > details > blockquote")!;
  expect(full.textContent).toBe(explanation.exactExplanation); expect(full).toBeVisible();
  expect(JSON.stringify({ trace, patch })).toBe(before); expect(fetch).not.toHaveBeenCalled();
});
