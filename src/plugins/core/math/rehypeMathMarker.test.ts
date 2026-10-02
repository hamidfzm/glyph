import rehypeStringify from "rehype-stringify";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { rehypeMathMarker } from "./rehypeMathMarker";

// Stands in for the host's source-line stamp on top-level blocks.
interface Block {
  type: string;
  position?: { start: { line: number } };
  properties?: object;
}

function stampLines() {
  return (tree: unknown) => {
    for (const node of (tree as { children: Block[] }).children) {
      if (node.type === "element" && node.position) {
        node.properties = { ...node.properties, dataLine: String(node.position.start.line) };
      }
    }
  };
}

async function mark(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkRehype)
    .use(stampLines)
    .use(rehypeMathMarker)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

describe("rehypeMathMarker", () => {
  it("wraps inline math in a span carrying its source", async () => {
    const html = await mark("area $\\pi r^2$ here");
    expect(html).toContain(
      '<span data-math-source="\\pi r^2"><code class="language-math math-inline">',
    );
  });

  it("wraps a display block in a marked div that keeps its source line", async () => {
    const html = await mark("intro\n\n$$\na + b\n$$");
    // The <pre> stays inside: it is how rehype-katex picks display mode once
    // sanitize has stripped the `math-display` class.
    expect(html).toContain(
      '<div data-line="3" data-math-source="a + b" data-math-display=""><pre data-line="3"><code class="language-math math-display">',
    );
  });

  it("marks math nested in other blocks", async () => {
    const html = await mark("- item $x$");
    expect(html).toContain('<li>item <span data-math-source="x">');
  });

  it("tolerates sparse trees from other plugins", () => {
    const transform = rehypeMathMarker();
    expect(() => transform({ type: "root" })).not.toThrow();
    const math = {
      type: "element",
      tagName: "code",
      properties: { className: ["language-math", "math-inline"] },
      children: [{ type: "element", tagName: "wbr" }],
    };
    const tree = { type: "root", children: [math] };
    transform(tree);
    expect(tree.children[0]).toMatchObject({ tagName: "span", properties: { dataMathSource: "" } });
  });

  it("leaves ordinary code blocks alone", async () => {
    const html = await mark("```js\nlet a = 1;\n```");
    expect(html).toContain('<pre data-line="1"><code class="language-js">');
    expect(html).not.toContain("data-math-source");
  });
});
