import { describe, expect, it } from "vitest";
import { isD2File } from "./d2Extensions";

describe("isD2File", () => {
  it("matches .d2 case-insensitively", () => {
    expect(isD2File("/p/diagram.d2")).toBe(true);
    expect(isD2File("/p/DIAGRAM.D2")).toBe(true);
  });

  it("rejects other extensions and extensionless paths", () => {
    expect(isD2File("/p/notes.md")).toBe(false);
    expect(isD2File("/p/diagram.mmd")).toBe(false);
    expect(isD2File("/p/README")).toBe(false);
  });

  it("returns false when the path has no usable extension segment", () => {
    // "" → split(".").pop() is "" (falsy), exercising the no-extension branch.
    expect(isD2File("")).toBe(false);
    expect(isD2File("/p/trailingdot.")).toBe(false);
  });
});
