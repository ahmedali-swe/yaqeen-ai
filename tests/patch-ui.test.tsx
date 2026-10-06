import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisEmptyStates } from "../src/components/analysis-empty-states";
import { YaqeenPatchAction } from "../src/components/yaqeen-patch";
import { interpretationClaim, quotationClaim, relation, hadithEvidence, arabicExample } from "./fixtures/relation";

const analysis = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: interpretationClaim.text });
const trace = { claim: interpretationClaim, evidence: [hadithEvidence], analysis };
const patch = { action: "PATCH", originalText: interpretationClaim.text, proposedText: "الأعمال مرتبطة بالنيات", changes: [{ originalSegment: interpretationClaim.text, replacementSegment: "الأعمال مرتبطة بالنيات", mutationType: "UNSUPPORTED_INFERENCE", reason: "الشرط لا يثبته الحديث." }], preservedIntent: "ربط العمل بالنية دون إضافة شرط.", evidenceIds: [hadithEvidence.id], explanation: "الدليل يذكر النيات فقط." };
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());
describe("complete evidence reasoning → Patch UI", () => {
  it("resolves contextual evidence independently and preserves the Patch when switching back without extra calls", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ evidence: [hadithEvidence] })).mockResolvedValueOnce(Response.json({ evidence: [hadithEvidence], resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id } })).mockResolvedValueOnce(Response.json({ analysis })).mockResolvedValueOnce(Response.json({ patch }));
    render(<AnalysisEmptyStates extraction={{ claims: [quotationClaim, interpretationClaim] }} originalContent={arabicExample} />);
    await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
    await screen.findByRole("button", { name: "تحليل العلاقة" });
    await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" }));
    await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
    await user.click(screen.getByRole("button", { name: "تحليل العلاقة" }));
    expect(await screen.findByText("غير مدعوم")).toBeInTheDocument();
    expect(screen.queryByText("UNSUPPORTED_INFERENCE")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تصحيح يقين" }));
    await user.click(screen.getByRole("button", { name: "اقتراح تصحيح يقين" }));
    expect(await screen.findByRole("heading", { name: "بعد" })).toBeInTheDocument();
    expect(screen.getByText(patch.proposedText)).toBeInTheDocument();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[3][1]?.body as string)).toEqual({ ...trace, originalContent: arabicExample });
    await user.click(screen.getByRole("button", { name: "اختيار الادعاء ١" }));
    expect(screen.queryByRole("heading", { name: "بعد" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" }));
    expect(screen.getByRole("heading", { name: "بعد" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("has loading state and cancels stale Patch on unmount", async () => {
    const user = userEvent.setup(); let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<YaqeenPatchAction trace={trace} />);
    await user.click(screen.getByRole("button")); expect(screen.getByRole("button")).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("جارٍ");
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal; view.unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => resolve(Response.json({ patch })));
    expect(screen.queryByText(patch.proposedText)).not.toBeInTheDocument();
  });
  it("shows a safe error rather than a fake correction", async () => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ error: { code: "AI_UNAVAILABLE", message: "private details" } }, { status: 502 }));
    render(<YaqeenPatchAction trace={trace} />); await user.click(screen.getByRole("button"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("لم يصدر يقين نتيجة غير موثقة"); expect(alert.textContent).not.toMatch(/429|Groq|AI_UNAVAILABLE|private details/);
    expect(screen.queryByRole("heading", { name: "بعد" })).not.toBeInTheDocument();
  });
  it.each(["NO_SAFE_PATCH", "REFER_SPECIALIST"] as const)("renders explicit %s without a proposed religious edit", async (action) => {
    const user = userEvent.setup(); const selected = action === "REFER_SPECIALIST" ? { ...trace, analysis: { ...analysis, requiresSpecialist: true, verificationStatus: "REQUIRES_SPECIALIST" as const } } : trace;
    vi.mocked(fetch).mockResolvedValue(Response.json({ patch: { ...patch, action, proposedText: null, changes: [], evidenceIds: [] } }));
    render(<YaqeenPatchAction trace={selected} />); await user.click(screen.getByRole("button"));
    expect(await screen.findByRole("heading", { name: action === "REFER_SPECIALIST" ? "يحتاج مراجعة مختص" : "تعذر اقتراح تصحيح موثوق" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "بعد" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("rejects fake evidence IDs in a successful response", async () => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ patch: { ...patch, evidenceIds: ["invented"] } }));
    render(<YaqeenPatchAction trace={trace} />); await user.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذر قراءة");
  });
});
