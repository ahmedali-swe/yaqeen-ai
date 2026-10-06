import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceCard, evidenceExcerpt } from "../src/components/evidence-card";
import { dorarSearchUrl, hadithSearchText } from "../src/evidence/hadith-search";
import { hadithEvidence } from "./fixtures/relation";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("deterministic Dorar search hints", () => {
  const matn = "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى";
  const sourceText = `${"حدثنا الراوي عن الراوي. ".repeat(24)}«${matn}»`;
  it("prefers a source-matched exact quotation in a compound claim", () => {
    expect(hadithSearchText({ claimText: "قال الكاتب: «إنما الأعمال بالنيات»، ثم استنتج شرطًا.", displayedText: matn, sourceText })).toBe("إنما الأعمال بالنيات");
  });
  it("accepts an unmarked extracted QUOTE and preserves its original wording", () => {
    expect(hadithSearchText({ claimText: "إنما الأعمال بالنيات", claimType: "QUOTE", displayedText: matn, sourceText: "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ" })).toBe("إنما الأعمال بالنيات");
  });
  it("does not treat a changed or unmatched quoted assertion as a hadith quotation", () => {
    expect(hadithSearchText({ claimText: "«إنما الأعمال بالراحة النفسية»", displayedText: matn, sourceText })).toBe(matn);
  });
  it("ranks source matn spans by the selected claim instead of including the isnad", () => {
    const second = "الصلاة نور والصدقة برهان";
    expect(hadithSearchText({ claimText: "الصلاة والصدقة", displayedText: sourceText, sourceText: `${sourceText} «${second}»` })).toBe(second);
  });
  it("bounds a long matn using an exact matched word span", () => {
    const longMatn = `${"الأعمال مرتبطة بالمقاصد ".repeat(30)}الصلاة نور والصدقة برهان ${"الأعمال مرتبطة بالمقاصد ".repeat(30)}`;
    const query = hadithSearchText({ claimText: "الصلاة والصدقة", displayedText: longMatn, sourceText: `حدثنا راو «${longMatn}»` });
    expect(query.length).toBeLessThanOrEqual(320); expect(longMatn).toContain(query); expect(query).toContain("الصلاة");
    expect(query).not.toContain("حدثنا");
  });
  it("URI-encodes punctuation and Arabic without allowing query injection", () => {
    const text = "إنما الأعمال بالنيات & #؟";
    const url = dorarSearchUrl(text);
    expect(url).toBe(`https://dorar.net/site/search?q=${encodeURIComponent(text)}`);
    expect(new URL(url).searchParams.get("q")).toBe(text);
    expect([...new URL(url).searchParams.keys()]).toEqual(["q"]);
  });
  it("handles malformed Unicode safely when encoding a search-only query", () => {
    const text = `حديث ${String.fromCharCode(0xd800)}`;
    expect(new URL(dorarSearchUrl(text)).searchParams.get("q")).toBe(text.toWellFormed());
  });
});
describe("hadith-only compact user controls", () => {
  it("copies the exact displayed source excerpt, reports success briefly and never fetches Dorar", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const item = { ...hadithEvidence, exactText: `${"حدثنا الراوي عن الراوي. ".repeat(24)}«إنما الأعمال بالنيات وإنما لكل امرئ ما نوى»` };
    render(<EvidenceCard evidence={item} anchorText="«إنما الأعمال بالنيات»" anchorClaimType="QUOTE" />);
    const control = screen.getByRole("button", { name: "نسخ نص الحديث" });
    expect(control.textContent).toBe("");
    await user.click(control);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(evidenceExcerpt(item, "إنما الأعمال بالنيات"));
    expect(await screen.findByRole("status")).toHaveTextContent("تم النسخ");
    expect(fetcher).not.toHaveBeenCalled();
    vi.useFakeTimers();
    // A second copy schedules its feedback timer under the fake clock.
    await act(async () => { control.click(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(2_500); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    writeText.mockRestore();
  });
  it("copies full displayed text verbatim when no excerpt is used", async () => {
    const user = userEvent.setup(); const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<EvidenceCard evidence={hadithEvidence} />);
    await user.click(screen.getByRole("button", { name: "نسخ نص الحديث" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(hadithEvidence.exactText); writeText.mockRestore();
  });
  it("opens only a deterministic search in a separate tab with an Arabic icon label", () => {
    render(<EvidenceCard evidence={hadithEvidence} anchorText="إنما الأعمال بالنيات" anchorClaimType="QUOTE" />);
    const link = screen.getByRole("link", { name: "البحث في الدرر السنية" });
    expect(link.textContent).toBe(""); expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(new URL(link.getAttribute("href")!).pathname).toBe("/site/search");
    expect(new URL(link.getAttribute("href")!).searchParams.get("q")).toBe("إنما الأعمال بالنيات");
  });
  it("handles denied clipboard access without claiming success and permits retry", async () => {
    const user = userEvent.setup(); const writeText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce();
    render(<EvidenceCard evidence={hadithEvidence} />);
    await user.click(screen.getByRole("button", { name: "نسخ نص الحديث" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذر النسخ"); expect(screen.queryByText("تم النسخ")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "نسخ نص الحديث" }));
    expect(await screen.findByText("تم النسخ")).toBeInTheDocument(); writeText.mockRestore();
  });
  it("does not add hadith actions to Quran evidence", () => {
    render(<EvidenceCard evidence={{ ...hadithEvidence, sourceType: "QURAN", canonicalUrl: "https://quranpedia.net/surah/1/94", sourceName: "الموسوعة القرآنية" }} />);
    expect(screen.queryByRole("button", { name: "نسخ نص الحديث" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "البحث في الدرر السنية" })).not.toBeInTheDocument();
  });
});
