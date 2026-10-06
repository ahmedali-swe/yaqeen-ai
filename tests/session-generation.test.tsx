import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ClaimAnalysisProvider } from "../src/components/claim-analysis-provider";
import { AnalysisResults } from "../src/components/analysis-results";
import { ContentInput } from "../src/components/content-input";
import { readAnalysisSession } from "../src/components/analysis-session";
import { arabicExample, quotationClaim, interpretationClaim, hadithEvidence, relation } from "./fixtures/relation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
it("persists freshly generated extraction, contextual retrieval, reasoning and Patch across a full provider remount", async () => {
  const user = userEvent.setup();
  const analysis = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: interpretationClaim.text });
  const patch = { action: "PATCH", originalText: interpretationClaim.text, proposedText: "الأعمال مرتبطة بالنيات", changes: [{ originalSegment: interpretationClaim.text, replacementSegment: "الأعمال مرتبطة بالنيات", mutationType: "UNSUPPORTED_INFERENCE", reason: "الشرط لا يثبته الحديث." }], preservedIntent: "ربط العمل بالنية دون إضافة شرط.", evidenceIds: [hadithEvidence.id], explanation: "الدليل يذكر النيات فقط." };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ claims: [quotationClaim, interpretationClaim] }))
    .mockResolvedValueOnce(Response.json({ evidence: [hadithEvidence], resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id } }))
    .mockResolvedValueOnce(Response.json({ analysis })).mockResolvedValueOnce(Response.json({ patch }));
  vi.stubGlobal("fetch", fetcher);
  const first = render(<ClaimAnalysisProvider><ContentInput /><AnalysisResults /></ClaimAnalysisProvider>);
  await screen.findByText("لا توجد نتيجة استخراج في هذه الجلسة. أرسل نصًا من الصفحة الرئيسية.");
  await user.type(screen.getByRole("textbox"), arabicExample); await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
  await screen.findByRole("button", { name: "اختيار الادعاء ٢" }); await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" }));
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" })); await user.click(await screen.findByRole("button", { name: "تحليل العلاقة" }));
  await screen.findByRole("heading", { name: "غير مدعوم" }); await user.click(screen.getByRole("button", { name: "تصحيح يقين" }));
  await user.click(screen.getByRole("button", { name: "اقتراح تصحيح يقين" })); await screen.findByRole("heading", { name: "بعد" });
  const saved = readAnalysisSession(sessionStorage)!;
  expect(saved.report.states[interpretationClaim.id]).toMatchObject({ evidenceResult: { resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id } }, analysis, patch });
  first.unmount(); render(<ClaimAnalysisProvider><AnalysisResults /></ClaimAnalysisProvider>);
  expect(await screen.findByRole("heading", { name: "بعد" })).toBeInTheDocument();
  expect(screen.getByText(patch.proposedText)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "تحوّل المعنى" })); expect(screen.getByText("الدليل يدعم")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(4);
});
