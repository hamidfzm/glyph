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

  it("skips stylesheets whose rules can't be read (cross-origin)", () => {
    // A sheet that throws on `.cssRules` (as opaque cross-origin sheets do)
    // must be skipped, not abort the whole collection.
    const fakeDoc = {
      styleSheets: [
        {
          get cssRules() {
            throw new Error("SecurityError");
          },
        },
        { cssRules: [{ cssText: ".kept{color:green}" }] },
      ],
    } as unknown as Document;
    const css = collectStyles(fakeDoc);
    expect(css).toBe(".kept{color:green}");
  });

  it("skips sheets with no rule list", () => {
    const fakeDoc = {
      styleSheets: [{ cssRules: undefined }, { cssRules: [{ cssText: ".a{}" }] }],
    } as unknown as Document;
    expect(collectStyles(fakeDoc)).toBe(".a{}");
  });
});
