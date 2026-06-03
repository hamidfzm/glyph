import { describe, expect, it } from "vitest";
import { escapeXml } from "./escape";

describe("escapeXml", () => {
  it("escapes the five reserved markup characters", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;",
    );
  });

  it("escapes ampersands before other entities so they aren't double-encoded", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXml("Hello world")).toBe("Hello world");
  });
});
