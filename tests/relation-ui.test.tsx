import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisEmptyStates } from "../src/components/analysis-empty-states";
import { RelationAnalysisAction } from "../src/components/relation-analysis";
import { quotationInput, quotationClaim, interpretationClaim, relation, hadithEvidence } from "./fixtures/relation";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());
describe("claim-evidence relation UI", () => {
  it("requires explicit action after retrieval and renders the trace and meaning excess independently", async () => {
    const user = userEvent.setup();
    const result = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: "الراحة النفسية", reasoning: "النص المقدم لا ينص على الراحة النفسية شرطًا للقبول." });
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ evidence: [hadithEvidence], resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id } })).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<AnalysisEmptyStates extraction={{ claims: [quotationClaim, interpretationClaim] }} originalContent={quotationInput.originalContent} />);
    expect(screen.queryByRole("button", { name: "تحليل العلاقة" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" }));
    await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
    await user.click(await screen.findByRole("button", { name: "تحليل العلاقة" }));
    expect(screen.getByRole("button", { name: "جارٍ تحليل العلاقة…" })).toBeDisabled();
    await act(async () => resolve(Response.json({ analysis: result })));
    const trace = screen.getByRole("region", { name: "مسار الدليل" });
    for (const name of ["الاقتباس الأصلي", "الدليل", "التفسير المنشور", "العلاقة بالدليل", "موضع تغيّر المعنى"]) expect(within(trace).getByRole("heading", { name })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "غير مدعوم" })).toBeInTheDocument();
    expect(within(trace).getByText("استنتاج غير مدعوم")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "الأدلة" }));
    expect(within(screen.getByRole("region", { name: "المصدر والدليل" })).getByText(hadithEvidence.exactText)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تحوّل المعنى" }));
    const meaning = screen.getByRole("region", { name: "تحوّل المعنى" });
    expect(within(meaning).getByText("الراحة النفسية")).toBeInTheDocument();
    expect(within(meaning).getByText(result.supportedMeaning)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "العلاقة" }));
    expect(screen.getByText(result.reasoning)).toBeInTheDocument();
    expect(screen.getByText("الدليل المشار إليه في السياق")).toBeInTheDocument();
    const request = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect(request).toEqual({ claim: interpretationClaim, evidence: [hadithEvidence], originalContent: quotationInput.originalContent });
    await user.click(screen.getByRole("button", { name: "اختيار الادعاء ١" }));
    expect(screen.queryByText("غير مدعوم")).not.toBeInTheDocument();
    expect(screen.queryByText("الراحة النفسية")).not.toBeInTheDocument();
  });
  it("discards an in-flight result after changing claims", async () => {
    const user = userEvent.setup(); let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ evidence: [hadithEvidence] })).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<AnalysisEmptyStates extraction={{ claims: [quotationClaim, interpretationClaim] }} />);
    await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" })); await user.click(await screen.findByRole("button", { name: "تحليل العلاقة" }));
    const signal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" }));
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(Response.json({ analysis: relation() })));
    expect(screen.queryByText("مدعوم")).not.toBeInTheDocument();
  });
  it.each(["AI_NOT_CONFIGURED", "AI_TIMEOUT", "AI_UNAVAILABLE", "INVALID_AI_RESPONSE", "RATE_LIMITED"])("shows a sanitized %s error with retry", async (code) => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ error: { code, message: "private details" } }, { status: 502 }));
    render(<RelationAnalysisAction claim={quotationClaim} evidence={[hadithEvidence]} />);
    await user.click(screen.getByRole("button")); expect(await screen.findByRole("alert")).not.toBeEmptyDOMElement();
    expect(screen.queryByText("private details")).not.toBeInTheDocument(); expect(screen.getByRole("button")).toBeEnabled();
  });
  it("rejects an invented evidence selection in a successful response", async () => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ analysis: relation({ strongestEvidenceId: "invented" }) }));
    render(<RelationAnalysisAction claim={quotationClaim} evidence={[hadithEvidence]} />); await user.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذر قراءة"); expect(screen.queryByText("مدعوم")).not.toBeInTheDocument();
  });
  it("renders a specialist requirement without a personal ruling", async () => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ analysis: relation({ verificationStatus: "REQUIRES_SPECIALIST", relationType: "NONE", requiresSpecialist: true }) }));
    render(<RelationAnalysisAction claim={quotationClaim} evidence={[hadithEvidence]} />); await user.click(screen.getByRole("button"));
    expect(await screen.findByText("يحتاج مراجعة مختص")).toBeInTheDocument(); expect(screen.getByText(/لم يصدر النظام فتوى/)).toBeInTheDocument();
    expect(screen.queryByText(/confidence|ثقة|\d+%/i)).not.toBeInTheDocument();
  });
});
