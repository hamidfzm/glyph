import { describe, expect, it } from "vitest";
import { isExternalLinkUrl } from "./externalLink";

describe("isExternalLinkUrl", () => {
  it("accepts the schemes the opener allows", () => {
    for (const url of ["https://a.test", "HTTP://a.test", " mailto:x@a.test", "tel:+1"]) {
      expect(isExternalLinkUrl(url), url).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "obsidian://x",
      "../a.md",
      "",
    ]) {
      expect(isExternalLinkUrl(url), url).toBe(false);
    }
  });
});
