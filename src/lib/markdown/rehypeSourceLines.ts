// Structural shape of the hast nodes this touches, declared locally rather than
// pulling in a types-only dependency, as `wikilinkNodes` does for mdast.
interface SourceNode {
  type: string;
  position?: { start: { line: number } };
  properties?: Record<string, unknown>;
}

// Split view maps a scroll position between the source and the rendered output
// by looking for these markers, so only top-level blocks carry one: they are the
// units the editor can scroll to, and stamping deeper nodes would cost a walk of
// the whole tree for anchors nothing uses.
//
// Must run after rehype-sanitize. The schema strips `data-*` from document
// content, so every surviving marker is one this plugin computed rather than one
// the document supplied.
export function rehypeSourceLines() {
  return (tree: unknown) => {
    const { children = [] } = tree as { children?: SourceNode[] };
    for (const node of children) {
      if (node.type !== "element") continue;
      const line = node.position?.start.line;
      if (line === undefined) continue;
      node.properties = { ...node.properties, "data-line": String(line) };
    }
  };
}
