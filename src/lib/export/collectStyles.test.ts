import { describe, expect, it } from "vitest";
import { collectStyles } from "./collectStyles";

function makeDocWithSheet(css: string): Document {
  const doc = document.implementation.createHTMLDocument("t");
  const style = doc.createElement("style");
  style.textContent = css;
  doc.head.appendChild(style);
  return doc;
}

describe("collectStyles", () => {
  it("serializes the rules of every readable stylesheet", () => {
    const doc = makeDocWithSheet(".a{color:red}.b{margin:0}");
    const css = collectStyles(doc);
    expect(css).toContain("color: red");
    expect(css).toContain(".b");
  });

  it("returns an empty string when there are no stylesheets", () => {
    const doc = document.implementation.createHTMLDocument("empty");
    expect(collectStyles(doc)).toBe("");
  });
});
