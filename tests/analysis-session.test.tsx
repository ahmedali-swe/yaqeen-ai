import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClaimAnalysisProvider } from "../src/components/claim-analysis-provider";
import { AnalysisResults } from "../src/components/analysis-results";
import { ContentInput } from "../src/components/content-input";
import { ANALYSIS_SESSION_KEY, AnalysisSessionSchema, readAnalysisSession, writeAnalysisSession, type AnalysisSession } from "../src/components/analysis-session";
import { invalidateStage } from "../src/components/analysis-flow";
import { arabicExample, hadithEvidence, interpretationClaim, quotationClaim, relation } from "./fixtures/relation";
import { claim } from "./fixtures/claims";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const analysis = relation({ verificationStatus: "UNSUPPORTED", relationType: "UNSUPPORTED_INFERENCE", unsupportedPart: interpretationClaim.text });
const patch = { action: "PATCH" as const, originalText: interpretationClaim.text, proposedText: "الأعمال مرتبطة بالنيات", changes: [{ originalSegment: interpretationClaim.text, replacementSegment: "الأعمال مرتبطة بالنيات", mutationType: "UNSUPPORTED_INFERENCE" as const, reason: "الشرط لا يثبته الحديث." }], preservedIntent: "ربط العمل بالنية دون إضافة شرط.", evidenceIds: [hadithEvidence.id], explanation: "الدليل يذكر النيات فقط." };
function completedSession(): AnalysisSession {
  return AnalysisSessionSchema.parse({ version: 1, id: "stored-session", result: { claims: [quotationClaim, interpretationClaim] }, originalContent: arabicExample,
    report: { selectedClaimId: interpretationClaim.id, activeStages: { [quotationClaim.id]: "relation", [interpretationClaim.id]: "patch" }, states: {
      [quotationClaim.id]: { evidenceResult: { evidence: [hadithEvidence], resolution: { evidenceOrigin: "DIRECT", evidenceAnchorClaimId: null } }, analysis: relation() },
      [interpretationClaim.id]: { evidenceResult: { evidence: [hadithEvidence], resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: quotationClaim.id } }, analysis, patch },
    } },
  });
}
function seed() { sessionStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(completedSession())); }
function mount() { return render(<ClaimAnalysisProvider><AnalysisResults /></ClaimAnalysisProvider>); }
function step(name: string) { return within(screen.getByRole("navigation", { name: "مراحل التحليل" })).getByRole("button", { name }); }
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

it("empty extraction navigation keeps a valid empty session without inventing a claim ID", async () => {
  const empty = completedSession(); empty.result = { claims: [] }; empty.report = { selectedClaimId: "", states: {}, activeStages: {} };
  sessionStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(empty)); const user = userEvent.setup(); mount();
  await screen.findByRole("heading", { name: "لم يُستخرج ادعاء قابل للفحص" }); await user.click(step("الادعاءات"));
  expect(readAnalysisSession(sessionStorage)?.report).toEqual(empty.report); expect(fetch).not.toHaveBeenCalled();
});

it("completed backward and forward stage navigation reuses evidence, reasoning, drift and Patch without requests", async () => {
  seed(); const user = userEvent.setup(); mount();
  await screen.findByRole("heading", { name: "بعد" });
  for (const name of ["الادعاءات", "الأدلة", "العلاقة", "تحوّل المعنى", "تصحيح يقين", "الأدلة", "تصحيح يقين"]) {
    await user.click(step(name)); expect(step(name).closest("li")).toHaveAttribute("aria-current", "step");
    if (name === "الأدلة") { expect(screen.getByText(hadithEvidence.exactText)).toBeInTheDocument(); expect(screen.getByText("الدليل المشار إليه في السياق")).toBeInTheDocument(); }
    if (name === "العلاقة") expect(screen.getByRole("heading", { name: "غير مدعوم" })).toBeInTheDocument();
    if (name === "تحوّل المعنى") expect(screen.getByText("الدليل يدعم")).toBeInTheDocument();
    if (name === "تصحيح يقين") expect(screen.getByText(patch.proposedText)).toBeInTheDocument();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("claim switching preserves both independent verdicts and each claim's selected stage", async () => {
  seed(); const user = userEvent.setup(); mount(); await screen.findByRole("heading", { name: "بعد" });
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ١" })); expect(screen.getByRole("heading", { name: "مدعوم" })).toBeInTheDocument();
  await user.click(step("الأدلة")); expect(screen.getByText(hadithEvidence.exactText)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ٢" })); expect(screen.getByRole("heading", { name: "بعد" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "اختيار الادعاء ١" })); expect(step("الأدلة").closest("li")).toHaveAttribute("aria-current", "step");
  expect(fetch).not.toHaveBeenCalled();
});

it("refresh restores a generated result and selected stage, not merely extracted claims", async () => {
  seed(); const user = userEvent.setup(); const first = mount(); await screen.findByRole("heading", { name: "بعد" });
  await user.click(step("العلاقة"));
  await waitFor(() => expect(readAnalysisSession(sessionStorage)?.report.activeStages[interpretationClaim.id]).toBe("relation"));
  first.unmount(); mount();
  expect(await screen.findByRole("heading", { name: "غير مدعوم" })).toBeInTheDocument();
  await user.click(step("تصحيح يقين")); expect(screen.getByRole("heading", { name: "بعد" })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.getItem(ANALYSIS_SESSION_KEY)).toContain("CONTEXTUAL_ANCHOR");
});

it("new source analysis replaces the session before extraction completes and never restores old downstream work", async () => {
  seed(); const user = userEvent.setup(); let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ClaimAnalysisProvider><ContentInput /><AnalysisResults /></ClaimAnalysisProvider>);
  await screen.findByRole("heading", { name: "بعد" });
  const text = "The city was founded in 1900.";
  await user.type(screen.getByRole("textbox"), text); await user.click(screen.getByRole("button", { name: "ابدأ التحقق" }));
  expect(sessionStorage.getItem(ANALYSIS_SESSION_KEY)).toBeNull(); expect(screen.queryByRole("heading", { name: "بعد" })).not.toBeInTheDocument();
  finish(Response.json({ claims: [claim(text, { id: "new-claim" })] }));
  await waitFor(() => expect(readAnalysisSession(sessionStorage)?.originalContent).toBe(text));
  const session = readAnalysisSession(sessionStorage)!;
  expect(session.id).not.toBe("stored-session"); expect(session.report.states).toEqual({}); expect(session.report.activeStages).toEqual({});
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("explicit evidence re-analysis clears its dependent results only; the other claim is preserved", async () => {
  seed(); const user = userEvent.setup(); mount(); await screen.findByRole("heading", { name: "بعد" });
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await user.click(step("الأدلة")); await user.click(screen.getByRole("button", { name: "إعادة البحث عن الأدلة" }));
  expect(step("العلاقة")).toBeDisabled(); expect(step("تحوّل المعنى")).toBeDisabled(); expect(step("تصحيح يقين")).toBeDisabled();
  const session = readAnalysisSession(sessionStorage)!;
  expect(session.report.states[interpretationClaim.id]).toEqual({});
  expect(session.report.states[quotationClaim.id]).toEqual(completedSession().report.states[quotationClaim.id]);
  finish(Response.json(completedSession().report.states[interpretationClaim.id].evidenceResult));
  await screen.findByRole("button", { name: "تحليل العلاقة" }); expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("heading", { name: "غير مدعوم" })).not.toBeInTheDocument();
});

it("relation and Patch re-analysis preserve the upstream evidence and independently invalidate their dependents", async () => {
  seed(); const user = userEvent.setup(); mount(); await screen.findByRole("heading", { name: "بعد" });
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  await user.click(screen.getByRole("button", { name: "إعادة إعداد تصحيح يقين" }));
  let state = readAnalysisSession(sessionStorage)!.report.states[interpretationClaim.id];
  expect(state.patch).toBeUndefined(); expect(state.analysis).toEqual(analysis); expect(state.evidenceResult).toEqual(completedSession().report.states[interpretationClaim.id].evidenceResult);
  await user.click(step("العلاقة")); await user.click(screen.getByRole("button", { name: "إعادة تحليل العلاقة" }));
  state = readAnalysisSession(sessionStorage)!.report.states[interpretationClaim.id];
  expect(state.analysis).toBeUndefined(); expect(state.patch).toBeUndefined(); expect(state.evidenceResult).toEqual(completedSession().report.states[interpretationClaim.id].evidenceResult);
  expect(step("تحوّل المعنى")).toBeDisabled(); expect(step("تصحيح يقين")).toBeDisabled(); expect(fetch).toHaveBeenCalledTimes(2);
});

it("meaning re-analysis invalidates its reasoning source and Patch, while ordinary navigation does not", () => {
  const state = completedSession().report.states[interpretationClaim.id];
  expect(invalidateStage(state, "meaning")).toEqual({ evidenceResult: state.evidenceResult });
  expect(invalidateStage(state, "claims")).toEqual({});
});

it("rejects corrupt session JSON, stale anchor IDs, and unbound results before displaying them", () => {
  sessionStorage.setItem(ANALYSIS_SESSION_KEY, "{broken"); expect(readAnalysisSession(sessionStorage)).toBeNull(); expect(sessionStorage.getItem(ANALYSIS_SESSION_KEY)).toBeNull();
  const invalid = completedSession(); invalid.report.states[interpretationClaim.id].evidenceResult!.resolution!.evidenceAnchorClaimId = "unknown";
  sessionStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(invalid)); expect(readAnalysisSession(sessionStorage)).toBeNull();
  const unbound = completedSession(); unbound.report.states[interpretationClaim.id].patch!.evidenceIds = ["invented"];
  sessionStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(unbound)); expect(readAnalysisSession(sessionStorage)).toBeNull();
});

it("quota/storage failures keep the interactive in-memory session usable without permanent persistence", async () => {
  seed(); const user = userEvent.setup(); const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
  mount(); await screen.findByRole("heading", { name: "بعد" }); await user.click(step("العلاقة")); expect(screen.getByRole("heading", { name: "غير مدعوم" })).toBeInTheDocument();
  await user.click(step("تصحيح يقين")); expect(screen.getByRole("heading", { name: "بعد" })).toBeInTheDocument();
  expect(localStorage.getItem(ANALYSIS_SESSION_KEY)).toBeNull(); expect(fetch).not.toHaveBeenCalled(); storage.mockRestore();
});

it("oversized snapshots remove an older stored session instead of leaving stale restored results", () => {
  seed(); const huge = completedSession(); huge.report.states[interpretationClaim.id].evidenceResult!.evidence[0].exactText = "x".repeat(2_500_001);
  writeAnalysisSession(sessionStorage, huge); expect(sessionStorage.getItem(ANALYSIS_SESSION_KEY)).toBeNull();
});
