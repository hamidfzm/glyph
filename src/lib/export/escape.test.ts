import { describe, expect, it } from "vitest";
import { escapeStyleText, escapeXml } from "./escape";

describe("escapeStyleText", () => {
  it("escapes every closing-tag opener, whatever the case", () => {
    expect(escapeStyleText('a{content:"</style></STYLE>"}')).toBe(
      String.raw`a{content:"<\/style><\/STYLE>"}`,
    );
  });

  it("leaves other CSS untouched", () => {
    expect(escapeStyleText("a>b{width:calc(1px / 2)}")).toBe("a>b{width:calc(1px / 2)}");
  });
});

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
