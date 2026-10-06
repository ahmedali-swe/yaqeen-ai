import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EvidenceResults } from "../src/components/evidence-results";
import corpus from "./fixtures/hadith.json";
import { claim } from "./fixtures/claims";

const claims = [claim("إنما الأعمال بالنيات", { id: "1" }), claim("محطة القطار افتتحت أمس", { id: "2" })];
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());
it("selects a claim, displays loading then real source text and link without a verdict", async () => {
  const user = userEvent.setup(); let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<EvidenceResults claims={claims} />);
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  expect(screen.getByRole("button", { name: "جارٍ البحث عن الأدلة…" })).toBeDisabled();
  await act(async () => resolve(Response.json({ evidence: [{ ...corpus[0], relevanceScore: 0.98 }] })));
  expect(screen.getByText(corpus[0].exactText)).toBeInTheDocument();
  expect(screen.getByText(corpus[0].reference)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /عرض المرجع/ })).not.toBeInTheDocument();
  const search = new URL(screen.getByRole("link", { name: "البحث في الدرر السنية" }).getAttribute("href")!);
  expect(search.pathname).toBe("/site/search"); expect(search.searchParams.get("q")).toBe(corpus[0].exactText);
  expect(fetch).toHaveBeenCalledWith("/api/analyze/evidence", expect.objectContaining({ body: JSON.stringify({ claim: claims[0] }) }));
  expect(screen.queryByText(/SUPPORTED|UNSUPPORTED|مدعوم|غير مدعوم/)).not.toBeInTheDocument();
});
it("distinguishes empty results from provider failure and supports retry", async () => {
  const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "EVIDENCE_UNAVAILABLE" } }, { status: 502 })).mockResolvedValueOnce(Response.json({ evidence: [] }));
  render(<EvidenceResults claims={claims} />);
  await user.click(screen.getByRole("button")); expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر جلب الأدلة");
  await user.click(screen.getByRole("button")); expect(await screen.findByRole("status")).toHaveTextContent("لا تتوفر أدلة كافية");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("discards a late response when the selected claim changes", async () => {
  const user = userEvent.setup(); let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done; })); render(<EvidenceResults claims={claims} />);
  await user.click(screen.getByRole("button")); await user.selectOptions(screen.getByRole("combobox"), "2");
  await act(async () => resolve(Response.json({ evidence: [{ ...corpus[0], relevanceScore: 0.98 }] })));
  expect(screen.queryByText(corpus[0].exactText)).not.toBeInTheDocument();
  expect(screen.getByRole("button")).toBeEnabled();
});
it("rejects malformed or unsafe evidence links without rendering them", async () => {
  const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ evidence: [{ ...corpus[0], canonicalUrl: "javascript:alert(1)" }] })); render(<EvidenceResults claims={claims} />);
  await user.click(screen.getByRole("button")); await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("discloses incomplete retrieval", async () => {
  const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(Response.json({ evidence: [{ ...corpus[0], metadata: { ...corpus[0].metadata, retrievalIncomplete: true }, relevanceScore: 0.98 }] })); render(<EvidenceResults claims={claims} />);
  await user.click(screen.getByRole("button")); expect(await screen.findByRole("status")).toHaveTextContent("نتائج المصادر المتاحة فقط");
});
it("renders only returned Dorar metadata and labels search links separately from canonical citations", async () => {
  const user = userEvent.setup();
  const item = { ...corpus[0], canonicalUrl: null, reference: null, metadata: { provider: "dorar", narrator: null, scholar: null, grading: "إسناده جيد", sourceUrl: "https://dorar.net/hadith/search?q=test" } };
  vi.mocked(fetch).mockResolvedValue(Response.json({ evidence: [item] })); render(<EvidenceResults claims={claims} />);
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  await user.click(await screen.findByText("بيانات المرجع"));
  expect(screen.getByText("إسناده جيد")).toBeVisible();
  expect(screen.queryByText("الراوي")).not.toBeInTheDocument();
  expect(screen.queryByText(corpus[0].reference)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /عرض نتائج المصدر|عرض المرجع/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "البحث في الدرر السنية" })).toHaveAttribute("target", "_blank");
  expect(item.metadata.sourceUrl).toBe("https://dorar.net/hadith/search?q=test");
});
it("does not execute or render HTML from a plain Dorar evidence field", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValue(Response.json({ evidence: [{ ...corpus[0], exactText: '<img src="x" onerror="alert(1)">' }] }));
  const { container } = render(<EvidenceResults claims={claims} />);
  await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  expect(await screen.findByText('<img src="x" onerror="alert(1)">')).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
});
it("discloses a primary-corpus miss and optional Dorar outage without displaying a hard failure", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValue(Response.json({ evidence: [], retrieval: { hadithCorpus: "SAHIHAYN", hadith: "NO_LOCAL_MATCH", dorar: "UNAVAILABLE", quranpedia: "AVAILABLE" } }));
  render(<EvidenceResults claims={claims} />); await user.click(screen.getByRole("button", { name: "البحث عن الأدلة" }));
  expect(await screen.findByText(/تعذّر الوصول إلى أحد المصادر/)).toBeInTheDocument();
  expect(screen.getByText(/لا تتوفر أدلة كافية/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(screen.queryByText(/مدعوم|غير مدعوم/)).not.toBeInTheDocument();
});
