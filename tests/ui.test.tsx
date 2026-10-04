import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentInput } from "../src/components/content-input";
import AnalysisPage from "../src/app/analysis/page";
import { approvedSources } from "../src/sources/registry";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("foundation UI", () => {
  beforeEach(() => push.mockReset());
  it("blocks empty input and explains unavailable analysis", async () => {
    const user = userEvent.setup(); render(<ContentInput />);
    await user.click(screen.getByRole("button", { name: "تحليل المحتوى" }));
    expect(screen.getByRole("alert")).toHaveTextContent("أضف النص");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(/لا يُرسل المحتوى ولا يُحفظ/)).toBeInTheDocument();
  });
  it("opens only the empty results route without putting content in the URL", async () => {
    const user = userEvent.setup(); render(<ContentInput />);
    await user.type(screen.getByRole("textbox"), "نص خاص للاختبار");
    await user.click(screen.getByRole("button", { name: "تحليل المحتوى" }));
    expect(push).toHaveBeenCalledExactlyOnceWith("/analysis");
  });
  it("requires an image, permits local selection and removal", async () => {
    const user = userEvent.setup(); render(<ContentInput />);
    await user.click(screen.getByRole("radio", { name: "صورة" }));
    await user.click(screen.getByRole("button", { name: "تحليل المحتوى" }));
    expect(screen.getByRole("alert")).toHaveTextContent("اختر صورة");
    await user.upload(screen.getByLabelText("اختر صورة من جهازك"), new File(["image-test"], "test.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "تحليل المحتوى" }));
    expect(push).toHaveBeenCalledExactlyOnceWith("/analysis");
    await user.click(screen.getByRole("button", { name: "إزالة الصورة" }));
    expect(screen.queryByText("test.png")).not.toBeInTheDocument();
  });
  it("rejects invalid image selection even if the picker filter is bypassed", async () => {
    const user = userEvent.setup({ applyAccept: false }); render(<ContentInput />);
    await user.click(screen.getByRole("radio", { name: "صورة" }));
    await user.upload(screen.getByLabelText("اختر صورة من جهازك"), new File(["<svg/>"], "test.svg", { type: "image/svg+xml" }));
    expect(screen.getByRole("alert")).toHaveTextContent("PNG أو JPG أو WebP");
    expect(push).not.toHaveBeenCalled();
  });
  it("shows all five empty sections with no report or verification verdict", () => {
    render(<AnalysisPage />);
    for (const name of ["الادعاءات المستخرجة", "المصدر والدليل", "مسار الدليل", "تحوّل المعنى", "تصحيح يقين"]) {
      expect(screen.getByRole("heading", { name, level: 2 })).toBeInTheDocument();
    }
    expect(screen.getByRole("status")).toHaveTextContent("لم يُحلّل محتوى");
    expect(screen.getByText("لم يبدأ التحليل")).toBeInTheDocument();
    expect(approvedSources).toEqual([]);
  });
});
