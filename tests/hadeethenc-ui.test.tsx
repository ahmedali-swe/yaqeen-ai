import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EvidenceCard } from "../src/components/evidence-card";
import { EvidenceResults } from "../src/components/evidence-results";
import { MeaningChange } from "../src/components/relation-analysis";
import { YaqeenPatchAction } from "../src/components/yaqeen-patch";
import { resolveApprovedExplanations } from "../src/evidence/explanations/hadeethenc";
import { ClaimAnalysisProvider } from "../src/components/claim-analysis-provider";
import { AnalysisResults } from "../src/components/analysis-results";
import { ANALYSIS_SESSION_KEY, AnalysisSessionSchema, readAnalysisSession, type AnalysisSession } from "../src/components/analysis-session";
import { HADEETHENC_SOURCE_NAME } from "../src/evidence/explanations/types";
import { hadithEvidence, quotationClaim, interpretationClaim, arabicExample, relation } from "./fixtures/relation";
import { officialDetails } from "./fixtures/hadeethenc-transport";
import { groundingPayload } from "../src/ai/grounding-payload";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const analysis = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: interpretationClaim.text });
const patch = { action: "PATCH" as const, originalText: interpretationClaim.text, proposedText: "الأعمال بالنيات", changes: [{ originalSegment: interpretationClaim.text, replacementSegment: "الأعمال بالنيات", mutationType: "UNSUPPORTED_INFERENCE" as const, reason: "حذف الشرط غير المدعوم." }], preservedIntent: "بيان صلة الأعمال بالنيات.", evidenceIds: [hadithEvidence.id], explanation: "التعديل مقيد بالنص المقدم." };
async function completedSession(): Promise<AnalysisSession> {
  const approved = await resolveApprovedExplanations([hadithEvidence], quotationClaim.text);
  const evidenceResult = { evidence: [hadithEvidence], ...approved };
  return AnalysisSessionSchema.parse({ version: 1, id: "explanation-session", result: { claims: [quotationClaim, interpretationClaim] }, originalContent: arabicExample,
    report: { selectedClaimId: interpretationClaim.id, activeStages: { [quotationClaim.id]: "relation", [interpretationClaim.id]: "patch" }, states: {
      [quotationClaim.id]: { evidenceResult, analysis: relation() },
      [interpretationClaim.id]: { evidenceResult: { ...evidenceResult, resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id } }, analysis, patch },
    } },
  });
}
const step = (name: string) => within(screen.getByRole("navigation", { name: "مراحل التحليل" })).getByRole("button", { name });
it("AI payload compaction retains every secondary source and full explanation for UI/session", async () => {
  const session = await completedSession(), result = session.report.states[interpretationClaim.id].evidenceResult!;
  const secondary = { ...hadithEvidence, id: "secondary-full", exactText: "نص الدليل الثانوي المحفوظ كاملًا", relevanceScore: 0.1 };
  result.evidence.push(secondary);
  const before = JSON.stringify(result);
  const payload = groundingPayload({ claim: interpretationClaim, evidence: result.evidence, approvedExplanations: result.explanations, originalContent: session.originalContent });
  expect(payload.evidence).toHaveLength(1); expect(JSON.stringify(result)).toBe(before);
  sessionStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(session));
  expect(readAnalysisSession(sessionStorage)!.report.states[interpretationClaim.id].evidenceResult).toEqual(result);
  const view = render(<EvidenceResults claims={[interpretationClaim]} showReasoning={false} value={{ evidenceResult: result, analysis }} />);
  const user = userEvent.setup(); await user.click(screen.getByText("أدلة مرتبطة أخرى (1)"));
  expect(screen.getByText(secondary.exactText)).toBeVisible();
  await user.click(screen.getByText("الشرح المعتمد")); await user.click(screen.getByText("عرض الشرح كاملًا"));
  const full = view.container.querySelector(".approved-explanation > details > blockquote")!;
  expect(full.textContent).toBe(result.explanations![0].exactExplanation); expect(full).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});
it("displays exact attributed approved explanation separately, with local full expansion and no invented source URL", async () => {
  const approved = await resolveApprovedExplanations([hadithEvidence]), user = userEvent.setup();
  const { container } = render(<EvidenceCard evidence={hadithEvidence} explanation={approved.explanations[0]} />);
  await user.click(screen.getByText("الشرح المعتمد"));
  expect(screen.getByText(HADEETHENC_SOURCE_NAME)).toBeVisible();
  const excerpt = container.querySelector(".approved-explanation > blockquote")!.textContent!;
  expect(officialDetails[0].explanation.startsWith(excerpt)).toBe(true);
  await user.click(screen.getByText("عرض الشرح كاملًا"));
  const full = container.querySelector(".approved-explanation > details > blockquote")!;
  expect(full.textContent).toBe(officialDetails[0].explanation); expect(full).toBeVisible();
  expect(screen.queryByRole("link", { name: /عرض المرجع/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "نسخ نص الحديث" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "البحث في الدرر السنية" })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
it("labels meaning as Yaqeen analysis grounded in evidence and approved explanation", () => {
  render(<MeaningChange analysis={analysis} hasExplanation />);
  expect(screen.getByText("ما يدعمه الدليل والشرح المعتمد")).toBeInTheDocument();
  expect(screen.getByText("خلاصة يقين مبنية على الدليل والشرح المعتمد، وليست اقتباسًا من نص الشرح.")).toBeInTheDocument();
  expect(screen.queryByText("الشرح المعتمد يوضح")).not.toBeInTheDocument();
});
it("shows only the strongest candidate expanded and locally opens secondary sources with no requests", async () => {
  const other = { ...hadithEvidence, id: "related", exactText: "نص ثانٍ محفوظ للاختبار", sourceName: "مرجع آخر" };
  const user = userEvent.setup();
  render(<EvidenceResults claims={[quotationClaim]} showReasoning={false} value={{ evidenceResult: { evidence: [other, hadithEvidence] }, analysis: relation() }} />);
  expect(screen.getByText(hadithEvidence.exactText)).toBeVisible(); expect(screen.getByText(other.exactText)).not.toBeVisible();
  await user.click(screen.getByText("أدلة مرتبطة أخرى (1)"));
  expect(screen.getByText(other.exactText)).toBeVisible(); expect(fetch).not.toHaveBeenCalled();
});
it("removes duplicate Patch source panel while retaining internal evidence IDs", () => {
  render(<YaqeenPatchAction trace={{ claim: interpretationClaim, evidence: [hadithEvidence], analysis }} initialPatch={patch} />);
  expect(screen.queryByText("المرجع المستخدم")).not.toBeInTheDocument(); expect(screen.queryByRole("link", { name: /عرض المرجع/ })).not.toBeInTheDocument();
  expect(patch.evidenceIds).toEqual([hadithEvidence.id]); expect(screen.getByRole("heading", { name: "بعد" })).toBeInTheDocument();
});
it("navigation, claim switching and refresh reuse approved explanations with ZERO source or AI requests", async () => {
  const session = await completedSession(); sessionStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(session));
  const user = userEvent.setup(), view = render(<ClaimAnalysisProvider><AnalysisResults /></ClaimAnalysisProvider>);
  await screen.findByRole("heading", { name: "بعد" });
  await user.click(step("الأدلة")); await user.click(screen.getByText("الشرح المعتمد"));
  expect(screen.getByText(HADEETHENC_SOURCE_NAME)).toBeVisible();
  await user.click(step("تحوّل المعنى")); expect(screen.getByText("ما يدعمه الدليل والشرح المعتمد")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ١" })); expect(screen.getByRole("heading", { name: "مدعوم" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" })); await user.click(step("تصحيح يقين"));
  view.unmount(); render(<ClaimAnalysisProvider><AnalysisResults /></ClaimAnalysisProvider>);
  await screen.findByRole("heading", { name: "بعد" }); await user.click(step("الأدلة"));
  expect(readAnalysisSession(sessionStorage)!.report.states[interpretationClaim.id].evidenceResult!.explanations).toEqual(session.report.states[interpretationClaim.id].evidenceResult!.explanations);
  expect(fetch).not.toHaveBeenCalled(); expect(localStorage.getItem(ANALYSIS_SESSION_KEY)).toBeNull();
});
it("refresh discards explanation metadata that does not bind to the saved evidence", async () => {
  const session = await completedSession(); session.report.states[interpretationClaim.id].evidenceResult!.explanations![0].evidenceId = "unknown";
  sessionStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(session));
  expect(readAnalysisSession(sessionStorage)).toBeNull(); expect(sessionStorage.getItem(ANALYSIS_SESSION_KEY)).toBeNull();
});
it("existing relation and Patch requests carry saved exact explanation metadata", async () => {
  const session = await completedSession();
  delete session.report.states[interpretationClaim.id].patch;
  sessionStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(session));
  vi.mocked(fetch).mockResolvedValue(Response.json({ patch }));
  const user = userEvent.setup(); render(<ClaimAnalysisProvider><AnalysisResults /></ClaimAnalysisProvider>);
  await user.click(await screen.findByRole("button", { name: "اقتراح تصحيح يقين" }));
  await screen.findByRole("heading", { name: "بعد" });
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body.approvedExplanations).toEqual(session.report.states[interpretationClaim.id].evidenceResult!.explanations);
  expect(fetch).toHaveBeenCalledOnce();
});
