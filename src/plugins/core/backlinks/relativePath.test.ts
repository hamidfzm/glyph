import { describe, expect, it } from "vitest";
import { relativePath } from "./relativePath";

describe("relativePath", () => {
  it("writes a path inside the root relative to it", () => {
    expect(relativePath("/workspace/Notes/Travel.md", "/workspace")).toBe("Notes/Travel.md");
  });

  it("understands Windows separators", () => {
    expect(relativePath("C:\\workspace\\Notes\\Travel.md", "C:\\workspace")).toBe(
      "Notes\\Travel.md",
    );
  });

  it("falls back to the file name outside the root", () => {
    expect(relativePath("/elsewhere/Notes/Travel.md", "/workspace")).toBe("Travel.md");
    expect(relativePath("D:\\elsewhere\\Travel.md", "C:\\workspace")).toBe("Travel.md");
  });

  it("does not take a sibling folder sharing the root's prefix for the root", () => {
    expect(relativePath("/workspace-old/Travel.md", "/workspace")).toBe("Travel.md");
  });

  it("falls back to the file name without a workspace", () => {
    expect(relativePath("/workspace/Notes/Travel.md", null)).toBe("Travel.md");
  });

  it("keeps a bare file name as it is", () => {
    expect(relativePath("Travel.md", "/workspace")).toBe("Travel.md");
  });
});
