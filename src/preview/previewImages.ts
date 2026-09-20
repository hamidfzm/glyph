import { visit } from "unist-util-visit";
import { isRelativeLocalHref } from "@/lib/relativePath";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

type VisitTree = Parameters<typeof visit>[0];

// Rehype plugin for the Explorer preview. Relative images load from the
// previewed file's folder, which the preview handler serves read-only at
// `baseUrl`. Every other image becomes its alt text: a remote image would need
// the network, and a path outside that folder is not served.
export function rehypePreviewImages(baseUrl: string) {
  return (tree: HastNode) => {
    visit(
      tree as unknown as VisitTree,
      "element",
      (node: HastNode, index: number | undefined, parent: HastNode | undefined) => {
        if (node.tagName !== "img" || !parent?.children || index === undefined) return;
        const props = node.properties ?? {};
        const src = typeof props.src === "string" ? props.src : "";
        if (isInFolder(src)) {
          props.src = new URL(src, baseUrl).href;
          return;
        }
        const alt = typeof props.alt === "string" ? props.alt : "";
        parent.children[index] = { type: "text", value: alt };
      },
    );
  };
}

// URL resolution clamps `..` at the host root, so an escaping path would load
// a same-named file from the folder instead of failing.
function isInFolder(src: string): boolean {
  return isRelativeLocalHref(src) && !src.split(/[/\\]/).includes("..");
}
