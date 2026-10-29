import { visit } from "unist-util-visit";
import { isRelativeLocalHref } from "@/lib/relativePath";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

// Every element hast produces carries `properties`, empty object included.
interface HastElement extends HastNode {
  properties: Record<string, unknown>;
}

type VisitTree = Parameters<typeof visit>[0];

/** The URL of the image a relative `src` names in the folder the reader picked, or null when it holds none. */
export type PickedImages = (src: string) => string | null;

/**
 * Where relative images load from: the URL a host serves the document's folder
 * at, a folder the reader picked in the web viewer, or nowhere.
 */
export type ImageSource = string | PickedImages | null;

// Rehype plugin for the Explorer, Quick Look and web previews. Relative images
// load from the previewed file's folder, which an OS host serves read-only at
// a base URL; the web viewer has no folder until the reader picks one. Every
// other image becomes its alt text: a remote image would need the network,
// and a path outside that folder is not served. `onDrop` hears of each
// relative image left as alt text, so the web viewer knows to offer a folder.
export function rehypePreviewImages(images: ImageSource, onDrop: () => void) {
  return (tree: HastNode) => {
    visit(
      tree as unknown as VisitTree,
      "element",
      (node: HastElement, index: number | undefined, parent: HastNode | undefined) => {
        if (node.tagName !== "img" || !parent?.children || index === undefined) return;
        const props = node.properties;
        // Raw `<img>` in the document can reach here with neither attribute.
        const src = typeof props.src === "string" ? props.src : "";
        if (isInFolder(src)) {
          const url = resolveInFolder(images, src);
          if (url) {
            props.src = url;
            return;
          }
          onDrop();
        }
        const alt = typeof props.alt === "string" ? props.alt : "";
        parent.children[index] = { type: "text", value: alt };
      },
    );
  };
}

function resolveInFolder(images: ImageSource, src: string): string | null {
  if (!images) return null;
  if (typeof images === "string") return new URL(src, images).href;
  return images(src);
}

// URL resolution clamps `..` at the host root, so an escaping path would load
// a same-named file from the folder instead of failing.
function isInFolder(src: string): boolean {
  return isRelativeLocalHref(src) && !src.split(/[/\\]/).includes("..");
}
