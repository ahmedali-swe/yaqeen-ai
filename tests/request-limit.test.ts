import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reserveExtraction } from "../src/ai/request-limit";

beforeEach(() => { vi.stubGlobal("extractionBudget", undefined); vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("single-process extraction budget", () => {
  it("limits concurrency and releases the slot", () => {
    const first = reserveExtraction()!; const second = reserveExtraction()!; const third = reserveExtraction()!;
    expect(reserveExtraction()).toBeNull(); first();
    const next = reserveExtraction(); expect(next).not.toBeNull(); next!(); second(); third();
  });
  it("limits requests in a bounded rolling minute", () => {
    for (let i = 0; i < 15; i++) reserveExtraction()!();
    expect(reserveExtraction()).toBeNull(); vi.advanceTimersByTime(60_000);
    expect(reserveExtraction()).not.toBeNull();
  });
});
