import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./version";

describe("isNewerVersion", () => {
  it("returns true when the candidate is a higher patch/minor/major", () => {
    expect(isNewerVersion("0.8.2", "0.8.1")).toBe(true);
    expect(isNewerVersion("0.9.0", "0.8.1")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.8.1")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isNewerVersion("0.8.1", "0.8.1")).toBe(false);
  });

  it("returns false when the candidate is older", () => {
    expect(isNewerVersion("0.8.0", "0.8.1")).toBe(false);
    expect(isNewerVersion("0.7.9", "0.8.1")).toBe(false);
  });

  it("compares numerically, not lexically", () => {
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
  });

  it("treats missing trailing components as zero", () => {
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.1", "1.2")).toBe(true);
    expect(isNewerVersion("1.2", "1.2.1")).toBe(false);
  });

  it("ignores pre-release / non-numeric suffixes", () => {
    expect(isNewerVersion("1.2.0-beta", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.1-beta", "1.2.0")).toBe(true);
  });

  it("treats a fully non-numeric component as zero", () => {
    // "x" parses to NaN and is coerced to 0, so 1.x.0 === 1.0.0.
    expect(isNewerVersion("1.2.0", "1.x.0")).toBe(true);
    expect(isNewerVersion("1.x.0", "1.0.0")).toBe(false);
  });
});
