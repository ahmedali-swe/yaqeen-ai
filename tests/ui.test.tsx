import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentInput } from "../src/components/content-input";
import { ClaimAnalysisProvider } from "../src/components/claim-analysis-provider";
import AnalysisPage from "../src/app/analysis/page";
import { approvedSources } from "../src/sources/registry";
import { claim } from "./fixtures/claims";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
function renderForm() { return render(<ClaimAnalysisProvider><ContentInput /><AnalysisPage /></ClaimAnalysisProvider>); }

describe("claim extraction UI", () => {
  beforeEach(() => { push.mockReset(); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());
  it("blocks empty and very short input without contacting AI", async () => {
    const user = userEvent.setup(); renderForm();
    await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
    expect(screen.getByRole("alert")).toHaveTextContent("أضف النص");
    await user.type(screen.getByRole("textbox"), "قصير");
    await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
    expect(screen.getByRole("alert")).toHaveTextContent("١٠ أحرف");
    expect(fetch).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  });
  it("shows loading then response claims without verification judgments", async () => {
    const user = userEvent.setup(); let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done; }));
    renderForm(); const text = "The city was founded in 1900.";
    await user.type(screen.getByRole("textbox"), text);
    await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
    expect(screen.getByRole("button", { name: "جارٍ التحليل…" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
    resolve(Response.json({ claims: [claim(text)] }));
    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith("/analysis"));
    expect(fetch).toHaveBeenCalledWith("/api/analyze/claims", expect.objectContaining({ method: "POST", body: JSON.stringify({ text }) }));
    expect(screen.getByRole("navigation", { name: "مراحل التحليل" })).toHaveTextContent("الادعاءات — مكتمل");
    expect(screen.getByText("ادعاء عام")).toBeInTheDocument();
    expect(screen.queryByText(/SUPPORTED|UNSUPPORTED|مدعوم|غير مدعوم/)).not.toBeInTheDocument();
  });
  it("distinguishes an empty extraction from no extraction", async () => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ claims: [] })); renderForm();
    await user.type(screen.getByRole("textbox"), "I love this beautiful city.");
    await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
    expect(await screen.findByText("لم يُستخرج ادعاء قابل للفحص")).toBeInTheDocument();
  });
  it.each(["AI_NOT_CONFIGURED", "AI_TIMEOUT", "INVALID_AI_RESPONSE", "RATE_LIMITED"])("shows an error for %s without navigation", async (code) => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ error: { code } }, { status: 503 })); renderForm();
    await user.type(screen.getByRole("textbox"), "A sufficiently long statement.");
    await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
    expect(await screen.findByRole("alert")).not.toBeEmptyDOMElement(); expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeEnabled();
  });
  it("handles network failures without showing diagnostics", async () => {
    const user = userEvent.setup(); vi.mocked(fetch).mockRejectedValue(new Error("private upstream details")); renderForm();
    await user.type(screen.getByRole("textbox"), "A sufficiently long statement.");
    await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لم يصدر يقين نتيجة غير موثقة");
    expect(screen.queryByText("private upstream details")).not.toBeInTheDocument();
  });
  it("rejects malformed successful API data", async () => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ claims: [{ text: "broken" }] })); renderForm();
    await user.type(screen.getByRole("textbox"), "A sufficiently long statement.");
    await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر قراءة"); expect(push).not.toHaveBeenCalled();
  });
  it("hides unfinished image functionality from the competition UI", () => {
    renderForm();
    expect(screen.queryByRole("radio", { name: "صورة" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("اختر صورة من جهازك")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("starts with all five sections empty and only stage-approved sources registered", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "الادعاءات المستخرجة", level: 2 });
    for (const name of ["الادعاءات المستخرجة", "المصدر والدليل", "مسار الدليل", "تحوّل المعنى", "تصحيح يقين"]) {
      expect(screen.getByRole("heading", { name, level: 2 })).toBeInTheDocument();
    }
    expect(screen.getByRole("status")).toHaveTextContent("لا توجد نتيجة استخراج"); expect(approvedSources.map((source) => source.id)).toEqual(["hadeethenc-ar", "quranpedia-hafs", "quranpedia-tafsir-1", "sahihayn-bukhari", "sahihayn-muslim", "dorar-official-api"]);
  });
});
