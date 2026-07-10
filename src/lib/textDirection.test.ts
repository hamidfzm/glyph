import { describe, expect, it } from "vitest";
import { containsRtlText, isRtlText } from "./textDirection";

describe("isRtlText", () => {
  it("detects Persian, Arabic, and Hebrew as RTL", () => {
    expect(isRtlText("سلام دنیا")).toBe(true);
    expect(isRtlText("مرحبا بالعالم")).toBe(true);
    expect(isRtlText("שלום עולם")).toBe(true);
  });

  it("detects Latin text as LTR", () => {
    expect(isRtlText("Hello world")).toBe(false);
  });

  it("skips leading digits and punctuation to the first letter", () => {
    expect(isRtlText('1. "سلام"')).toBe(true);
    expect(isRtlText("1. hello")).toBe(false);
  });

  it("resolves LTR when there are no letters at all", () => {
    expect(isRtlText("123 !?")).toBe(false);
    expect(isRtlText("")).toBe(false);
    expect(isRtlText(null)).toBe(false);
    expect(isRtlText(undefined)).toBe(false);
  });

  it("follows the first strong character in mixed text", () => {
    expect(isRtlText("سلام means hello")).toBe(true);
    expect(isRtlText("hello یعنی سلام")).toBe(false);
  });
});

describe("containsRtlText", () => {
  it("finds RTL characters anywhere in the text", () => {
    expect(containsRtlText("hello یعنی سلام")).toBe(true);
    expect(containsRtlText("שלום in the middle")).toBe(true);
  });

  it("is false for pure LTR or empty text", () => {
    expect(containsRtlText("hello")).toBe(false);
    expect(containsRtlText("")).toBe(false);
    expect(containsRtlText(null)).toBe(false);
    expect(containsRtlText(undefined)).toBe(false);
  });
});
