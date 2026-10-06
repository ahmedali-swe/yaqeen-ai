import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalysisEmptyStates } from "../src/components/analysis-empty-states";
import { EvidenceCard, evidenceExcerpt } from "../src/components/evidence-card";
import { arabicExample, quotationClaim, interpretationClaim, hadithEvidence, relation } from "./fixtures/relation";
import { bukhari71Content, bukhari71Quote, bukhari71Conclusion } from "./fixtures/bukhari-71";
import { WorkflowStepper } from "../src/components/workflow-stepper";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const claims = [quotationClaim, interpretationClaim];
it("finishes a genuine empty extraction without claiming an actionable evidence stage", () => {
  render(<AnalysisEmptyStates extraction={{ claims: [] }} />);
  const steps = screen.getByRole("navigation", { name: "مراحل التحليل" });
  expect(steps.querySelectorAll(".is-complete")).toHaveLength(1);
  expect(steps.querySelector("[aria-current] ")).toBeNull();
  expect(screen.queryByRole("button", { name: "البحث عن الأدلة" })).not.toBeInTheDocument();
});
it("hides internal English/search helpers and keeps future stages compact and locked", () => {
  const { container } = render(<AnalysisEmptyStates extraction={{ claims }} originalContent={arabicExample} />);
  expect(container.textContent).not.toMatch(/This statement|normalizedText|صياغة للبحث|GENERAL_CLAIM|QUOTE/);
  expect(container.querySelectorAll(".future-stage")).toHaveLength(0);
  for (const name of ["العلاقة", "تحوّل المعنى", "تصحيح يقين"]) expect(screen.getByRole("button", { name })).toBeDisabled();
  expect(container.querySelector(".empty-state")).toBeNull();
  const steps = screen.getByRole("navigation", { name: "مراحل التحليل" });
  expect(steps).toHaveTextContent("الادعاءات — مكتمل");
  expect(within(steps).getByText(/الأدلة/).closest("li")).toHaveAttribute("aria-current", "step");
  expect(steps.querySelectorAll(".is-complete")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "اختيار الادعاء ١" })).toHaveAttribute("aria-pressed", "true");
});
it("shows one source heading, a short reference and a clearly labelled Dorar search action", () => {
  const { container } = render(<EvidenceCard evidence={{ ...hadithEvidence, metadata: { ...hadithEvidence.metadata, hadithNumber: "1" } }} />);
  expect(screen.getAllByText(hadithEvidence.sourceName)).toHaveLength(1);
  expect(screen.getByText("حديث رقم 1")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /عرض المرجع/ })).not.toBeInTheDocument();
  expect(new URL(screen.getByRole("link", { name: "البحث في الدرر السنية" }).getAttribute("href")!).origin).toBe("https://dorar.net");
  expect(hadithEvidence.canonicalUrl).toBeTruthy();
  expect(container.textContent).not.toMatch(/Hugging|المصدر الأصلي/);
});
it("shows an exact excerpt with the full immutable source in a keyboard-accessible disclosure", async () => {
  const user = userEvent.setup();
  const item = { ...hadithEvidence, exactText: `${"حدثنا الراوي عن الراوي. ".repeat(24)}«إنما الأعمال بالنيات وإنما لكل امرئ ما نوى»` };
  const snapshot = JSON.stringify(item);
  expect(evidenceExcerpt(item, quotationClaim.text)).toBe("إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");
  render(<EvidenceCard evidence={item} anchorText={quotationClaim.text} />);
  const summary = screen.getByText("عرض النص الكامل والإسناد");
  expect(screen.getByText(item.exactText)).not.toBeVisible();
  await user.click(summary);
  expect(screen.getByText(item.exactText)).toBeVisible();
  expect(JSON.stringify(item)).toBe(snapshot);
});
it("keeps evidence through a reasoning failure and retries only that stage", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ evidence: [hadithEvidence] }))
    .mockResolvedValueOnce(Response.json({ error: { code: "AI_UNAVAILABLE", message: "Groq 429 secret" } }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ analysis: relation() }));
  render(<AnalysisEmptyStates extraction={{ claims }} />);
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  await user.click(await screen.findByRole("button", { name: "تحليل العلاقة" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("لم يصدر يقين نتيجة غير موثقة."); expect(alert.textContent).not.toMatch(/429|Groq|secret|AI_UNAVAILABLE/);
  expect(screen.getByRole("button", { name: "الأدلة" })).toBeEnabled();
  expect(screen.queryByRole("heading", { name: "مدعوم" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
  expect(await screen.findByRole("heading", { name: "مدعوم" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "الأدلة" }));
  expect(screen.getByText(hadithEvidence.exactText)).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/analyze/evidence", "/api/analyze/relation", "/api/analyze/relation"]);
});
it("never inherits the quote verdict and restores each independent result without new AI calls", async () => {
  const user = userEvent.setup(); let finish!: (value: Response) => void;
  const unsupported = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: "الراحة النفسية" });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ evidence: [hadithEvidence] }))
    .mockResolvedValueOnce(Response.json({ analysis: relation() }))
    .mockResolvedValueOnce(Response.json({ evidence: [hadithEvidence], resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id } }))
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<AnalysisEmptyStates extraction={{ claims }} originalContent={arabicExample} />);
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  await user.click(await screen.findByRole("button", { name: "تحليل العلاقة" }));
  expect(await screen.findByRole("heading", { name: "مدعوم" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" }));
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  expect(await screen.findByText("الدليل المشار إليه في السياق")).toBeInTheDocument();
  expect(screen.getByText("استخدم يقين الدليل المرتبط بالادعاء السابق لتقييم هذا الاستنتاج.")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "مدعوم" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "تحليل العلاقة" }));
  await act(async () => finish(Response.json({ analysis: unsupported })));
  expect(screen.getByRole("heading", { name: "غير مدعوم" })).toBeInTheDocument();
  const lineage = screen.getByRole("region", { name: "مسار الدليل" });
  expect(within(lineage).getByRole("heading", { name: "الاقتباس الأصلي" })).toBeInTheDocument();
  expect(within(lineage).getByRole("heading", { name: "التفسير المنشور" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ١" }));
  expect(screen.getByRole("heading", { name: "مدعوم" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" }));
  expect(screen.getByRole("heading", { name: "غير مدعوم" })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("does not claim meaning drift when no evidence was found", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ evidence: [] })).mockResolvedValueOnce(Response.json({ analysis: relation({ verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: null }) }));
  render(<AnalysisEmptyStates extraction={{ claims }} />);
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  await user.click(await screen.findByRole("button", { name: "تحليل العلاقة" }));
  expect(await screen.findByText("لا يمكن تقييم تحوّل المعنى أو اقتراح تصحيح موثوق لعدم توفر دليل كافٍ.")).toBeInTheDocument();
  expect(screen.queryByText("المحتوى أضاف")).not.toBeInTheDocument();
  const steps = screen.getByRole("navigation", { name: "مراحل التحليل" });
  expect(steps.querySelectorAll(".is-complete")).toHaveLength(3);
  expect(within(steps).getByRole("button", { name: "العلاقة" }).closest("li")).toHaveAttribute("aria-current", "step");
  expect(within(steps).getByText(/تعذر الاستكمال/)).toBeInTheDocument();
  expect(within(steps).queryByText(/تصحيح يقين|تحوّل المعنى/)).not.toBeInTheDocument();
  expect(screen.getByText("لا يمكن تقييم تحوّل المعنى أو اقتراح تصحيح موثوق لعدم توفر دليل كافٍ.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "اقتراح تصحيح يقين" })).not.toBeInTheDocument();
});

it("stops when retrieved evidence cannot establish a relation instead of activating Patch", () => {
  render(<WorkflowStepper extracted state={{ evidenceResult: { evidence: [hadithEvidence] }, analysis: relation({ verificationStatus: "NEEDS_CONTEXT", relationType: "NONE", strongestEvidenceId: null }) }} />);
  const steps = screen.getByRole("navigation", { name: "مراحل التحليل" });
  expect(steps.querySelectorAll(".is-complete")).toHaveLength(3);
  expect(steps.querySelector("[aria-current]")).toBeNull(); expect(steps).toHaveTextContent("تعذر الاستكمال");
  expect(steps).not.toHaveTextContent("تصحيح يقين");
});

it("sends the Bukhari 71 original discourse and offsets, then analyzes the conclusion independently", async () => {
  const user = userEvent.setup();
  const evidence = { ...hadithEvidence, id: "sahihayn-bukhari-71", reference: "صحيح البخاري، حديث 71", canonicalUrl: "https://sunnah.com/bukhari:71" };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ evidence: [evidence], resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: bukhari71Quote.id } }))
    .mockResolvedValueOnce(Response.json({ analysis: relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", strongestEvidenceId: evidence.id, unsupportedPart: "فهذا دليل على أن الله لا يريد به خيرًا" }) }));
  render(<AnalysisEmptyStates extraction={{ claims: [bukhari71Quote, bukhari71Conclusion] }} originalContent={bukhari71Content} />);
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" }));
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  expect(await screen.findByText("الدليل المشار إليه في السياق")).toBeInTheDocument();
  const evidenceBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
  expect(evidenceBody.context).toMatchObject({ originalContent: bukhari71Content, evidenceAnchorClaimId: bukhari71Quote.id });
  expect(evidenceBody.claim.originalStart).toBe(bukhari71Conclusion.originalStart);
  expect(screen.queryByRole("heading", { name: "مدعوم" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "تحليل العلاقة" }));
  expect(await screen.findByRole("heading", { name: "غير مدعوم" })).toBeInTheDocument();
  const relationBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
  expect(relationBody.claim).toEqual(bukhari71Conclusion); expect(relationBody.evidence).toEqual([evidence]);
  expect(relationBody).not.toHaveProperty("analysis");
});
