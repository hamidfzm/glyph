// @vitest-environment jsdom
// The real DOMPurify, which needs jsdom's spec-compliant parser (under
// happy-dom it drops the <svg>); Mermaid's layout needs a real engine, so its
// output comes from a fixture.
import { beforeEach, describe, expect, it, vi } from "vitest";

const renderSvg = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => renderSvg(...args),
  },
}));

import { renderMermaid } from "./mermaidRender";

function label(html: string): string {
  return `<g class="label"><rect></rect><foreignObject width="40" height="24"><div xmlns="http://www.w3.org/1999/xhtml" style="display: table-cell; white-space: nowrap;"><span class="nodeLabel">${html}</span></div></foreignObject></g>`;
}

// Mermaid 11.17.2's strict render of `flowchart TD; A[Start] --> B{Check}`,
// trimmed to its structure.
function flowchart(nodeA: string, nodeB: string): string {
  return [
    '<svg id="mermaid-diagram-0" xmlns="http://www.w3.org/2000/svg" class="flowchart" aria-roledescription="flowchart-v2">',
    "<style>#mermaid-diagram-0 .label{color:#ccc;}</style>",
    '<g class="root"><g class="nodes">',
    `<g class="node default"><rect class="basic label-container"></rect>${label(nodeA)}</g>`,
    `<g class="node default"><polygon class="label-container" points="0,0 1,1"></polygon>${label(nodeB)}</g>`,
    "</g></g></svg>",
  ].join("");
}

// The on-screen SVG is put in the page through innerHTML, so it is read back
// the same way.
function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, "text/html");
}

function labelTexts(svg: string): string[] {
  return Array.from(parse(svg).querySelectorAll(".nodeLabel"), (el) => el.textContent ?? "");
}

describe("renderMermaid with the real sanitizer", () => {
  beforeEach(() => {
    renderSvg.mockReset();
  });

  it("keeps a flowchart's HTML node labels", async () => {
    renderSvg.mockResolvedValue({ svg: flowchart("<p>Start</p>", "<p>Check</p>") });
    const svg = await renderMermaid("flowchart TD; A[Start] --> B{Check}", true);
    expect(labelTexts(svg)).toEqual(["Start", "Check"]);
    expect(parse(svg).querySelector("svg")?.getAttribute("aria-roledescription")).toBe(
      "flowchart-v2",
    );
  });

  // A label is HTML, so allowing <foreignObject> must not let script, a
  // handler, a frame or a link through. Mermaid's strict level strips most of
  // these first; this pass does not rely on it.
  it("strips script, handlers, frames and links from inside a label", async () => {
    const hostile = [
      '<img src="x" onerror="alert(1)">',
      "<script>alert(2)</script>",
      '<iframe src="https://attacker.example"></iframe>',
      '<a href="https://attacker.example">Open</a>',
      '<math><mtext><table><mglyph><style><img src="x" onerror="alert(3)"></style></mglyph></table></mtext></math>',
    ].join("");
    renderSvg.mockResolvedValue({ svg: flowchart(hostile, "<p>Check</p>") });
    const svg = await renderMermaid("flowchart TD; A[hostile] --> B{Check}", false);
    expect(parse(svg).querySelector("script, iframe, a, math, [onerror]")).toBeNull();
    // The link's text stays as the label.
    expect(labelTexts(svg)).toEqual(["Open", "Check"]);
  });

  // Mermaid keeps `click A href "..."` under its strict level as an SVG anchor
  // around the node. It does not go through the link component, so a click
  // would navigate the webview itself; the anchor goes and the node stays.
  it("drops a click link's anchor and keeps the node it wrapped", async () => {
    renderSvg.mockResolvedValue({
      svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://attacker.example"><g class="node">${label("<p>Start</p>")}</g></a></svg>`,
    });
    const svg = await renderMermaid(
      'flowchart TD; A[Start]; click A href "https://attacker.example"',
      false,
    );
    expect(parse(svg).querySelector("a")).toBeNull();
    expect(labelTexts(svg)).toEqual(["Start"]);
  });
});
