import { describe, expect, it } from "vitest";
import { adaptD2Content, isD2File } from "./d2Extensions";

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

describe("adaptD2Content", () => {
  it("wraps a .d2 body in a d2 fence", () => {
    expect(adaptD2Content("/p/a.d2", "x -> y")).toBe("```d2\nx -> y\n```\n");
  });

  it("trims trailing whitespace before fencing", () => {
    expect(adaptD2Content("/p/a.d2", "x -> y\n\n  ")).toBe("```d2\nx -> y\n```\n");
  });

  it("leaves non-.d2 content untouched", () => {
    expect(adaptD2Content("/p/a.md", "x -> y")).toBe("x -> y");
  });
});
