import { describe, expect, it } from "vitest";
import { isLooseFilePath } from "./looseFile";

describe("isLooseFilePath", () => {
  it("is false when there is no workspace to contrast against", () => {
    expect(isLooseFilePath("/p/a.md", null)).toBe(false);
    expect(isLooseFilePath("/p/a.md", undefined)).toBe(false);
    expect(isLooseFilePath("/p/a.md", "")).toBe(false);
  });

  it("is false for files inside the workspace", () => {
    expect(isLooseFilePath("/ws/a.md", "/ws")).toBe(false);
    expect(isLooseFilePath("/ws/sub/a.md", "/ws")).toBe(false);
    expect(isLooseFilePath("C:\\ws\\a.md", "C:\\ws")).toBe(false);
  });

  it("is true for files outside the workspace", () => {
    expect(isLooseFilePath("/other/a.md", "/ws")).toBe(true);
    expect(isLooseFilePath("/wsabc/a.md", "/ws")).toBe(true); // prefix, not a child
    expect(isLooseFilePath("C:\\other\\a.md", "C:\\ws")).toBe(true);
  });

  it("treats the workspace root path itself as inside", () => {
    expect(isLooseFilePath("/ws", "/ws")).toBe(false);
  });
});
