// Wraps each math element remark-math emits in the marker exports key on:
// `data-math-source` holding its TeX, plus `data-math-display` on block math.
// rehype-katex replaces the math element itself, so the wrapper is also what
// keeps a top-level block's `data-line` for split view scroll sync. A block
// keeps its <pre> inside the wrapper: sanitize strips the `math-display`
// class, so the <pre> parent is how rehype-katex knows to render it as display.

// Structural shape of the hast nodes this touches, declared locally rather
// than pulling in a types-only dependency.
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function isMath(node: HastNode): boolean {
  const className = node.properties?.className;
  return (
    node.type === "element" &&
    node.tagName === "code" &&
    Array.isArray(className) &&
    className.includes("language-math")
  );
}

function textOf(node: HastNode): string {
  return node.value ?? (node.children ?? []).map(textOf).join("");
}

function mark(parent: HastNode): void {
  const children = parent.children ?? [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== "element") continue;
    const block = node.tagName === "pre" ? node.children?.[0] : undefined;
    if (block && node.children?.length === 1 && isMath(block)) {
      children[i] = {
        type: "element",
        tagName: "div",
        properties: { ...node.properties, dataMathSource: textOf(block), dataMathDisplay: "" },
        children: [node],
      };
    } else if (isMath(node)) {
      children[i] = {
        type: "element",
        tagName: "span",
        properties: { dataMathSource: textOf(node) },
        children: [node],
      };
    } else {
      mark(node);
    }
  }
}

export function rehypeMathMarker() {
  return (tree: unknown) => mark(tree as HastNode);
}
