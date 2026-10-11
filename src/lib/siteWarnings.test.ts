import { describe, expect, it } from "vitest";
import { siteWarnings, warningLine } from "./siteWarnings";

describe("siteWarnings", () => {
  it("has none for an export that ran clean", () => {
    expect(siteWarnings({ failedAssets: [], pruneError: null })).toEqual([]);
  });

  it("carries a failed cleanup with its reason", () => {
    expect(siteWarnings({ failedAssets: [], pruneError: "locked" })).toEqual([
      { kind: "pruneFailed", reason: "locked" },
    ]);
  });

  it("gives the first failed copy in full and the rest as a count", () => {
    const failedAssets = ['"a.png": os error 2', '"b.png": os error 5', '"c.mp4": os error 5'];
    expect(siteWarnings({ failedAssets, pruneError: null })).toEqual([
      { kind: "assetsFailed", reason: '"a.png": os error 2', more: 2 },
    ]);
  });

  it("puts the files the pages use ahead of the cleanup", () => {
    const failedAssets = ['"a.png": os error 2'];
    expect(siteWarnings({ failedAssets, pruneError: "locked" })).toEqual([
      { kind: "assetsFailed", reason: '"a.png": os error 2', more: 0 },
      { kind: "pruneFailed", reason: "locked" },
    ]);
  });

  it("keeps a failed cleanup whose reason is empty", () => {
    expect(siteWarnings({ failedAssets: [], pruneError: "" })).toEqual([
      { kind: "pruneFailed", reason: "" },
    ]);
  });
});

describe("warningLine", () => {
  it("says what a failed copy means for the pages", () => {
    const warning = { kind: "assetsFailed", reason: '"a.png": os error 2', more: 0 } as const;
    expect(warningLine(warning)).toBe(
      "Warning: some files the pages use could not be copied, so those pages may show a " +
        'missing or outdated image, media file or download: "a.png": os error 2',
    );
  });

  it("counts the copies that failed beside the one it names", () => {
    const warning = { kind: "assetsFailed", reason: '"a.png": os error 2', more: 2 } as const;
    expect(warningLine(warning)).toMatch(
      /: "a\.png": os error 2 \(2 more could not be copied either\)$/,
    );
  });

  it("says what a failed cleanup means for the folder", () => {
    expect(warningLine({ kind: "pruneFailed", reason: "locked" })).toBe(
      "Warning: the cleanup after the export did not finish, so outdated pages may be left " +
        "in the folder, now or after a later export: locked",
    );
  });
});
