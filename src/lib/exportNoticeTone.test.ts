import { describe, expect, it } from "vitest";
import { exportNoticeTone } from "./exportNoticeTone";

describe("exportNoticeTone", () => {
  it("informs about a copied share link", () => {
    expect(exportNoticeTone({ kind: "linkCopied" })).toBe("info");
  });

  it("warns about a website's shortfalls", () => {
    expect(exportNoticeTone({ kind: "siteWarnings", warnings: [] })).toBe("warning");
  });

  it.each([
    { kind: "insideWorkspace" },
    { kind: "failed", reason: "disk full" },
    { kind: "siteFailed", reason: "disk full" },
    { kind: "linkTooLong" },
    { kind: "linkFailed" },
  ] as const)("treats $kind as an error", (notice) => {
    expect(exportNoticeTone(notice)).toBe("error");
  });
});
