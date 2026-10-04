import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, MAX_TEXT_LENGTH, validateImage, validateText } from "../src/lib/input";

describe("input boundaries", () => {
  it("rejects whitespace-only text", () => { expect(validateText(" \n ")).not.toBeNull(); });
  it("accepts nonempty text at the limit", () => { expect(validateText("أ".repeat(MAX_TEXT_LENGTH))).toBeNull(); });
  it("rejects oversized text", () => { expect(validateText("أ".repeat(MAX_TEXT_LENGTH + 1))).not.toBeNull(); });
  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s at the byte limit", (type) => {
    expect(validateImage({ type, size: MAX_IMAGE_BYTES })).toBeNull();
  });
  it("rejects empty and oversized images", () => {
    expect(validateImage({ type: "image/png", size: 0 })).not.toBeNull();
    expect(validateImage({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).not.toBeNull();
  });
  it("rejects SVG and unknown formats", () => {
    expect(validateImage({ type: "image/svg+xml", size: 100 })).not.toBeNull();
    expect(validateImage({ type: "", size: 100 })).not.toBeNull();
  });
});
