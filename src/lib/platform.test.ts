import { describe, expect, it } from "vitest";
import { isMac, modKey } from "./platform";

describe("isMac", () => {
  it("returns true for macos", () => {
    expect(isMac("macos")).toBe(true);
  });

  it("returns false for windows", () => {
    expect(isMac("windows")).toBe(false);
  });

  it("returns false for linux", () => {
    expect(isMac("linux")).toBe(false);
  });

  it("returns false for unknown", () => {
    expect(isMac("unknown")).toBe(false);
  });
});

describe("modKey", () => {
  it("returns ⌘ for macos", () => {
    expect(modKey("macos")).toBe("⌘");
  });

  it("returns Ctrl for windows", () => {
    expect(modKey("windows")).toBe("Ctrl");
  });

  it("returns Ctrl for linux", () => {
    expect(modKey("linux")).toBe("Ctrl");
  });

  it("returns Ctrl for unknown", () => {
    expect(modKey("unknown")).toBe("Ctrl");
  });
});
