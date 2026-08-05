import type { CanvasNode } from "./types";

/** The inline-editable value for a node: markdown body, group label, or URL. */
export function editValue(node: CanvasNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "group":
      return node.label ?? "";
    case "link":
      return node.url;
    /* v8 ignore start -- defensive: file nodes are not editable, so this is never read */
    default:
      return "";
    /* v8 ignore stop */
  }
}

/** i18n key for the inline-editor placeholder, per node type. */
export function editPlaceholderKey(node: CanvasNode): string {
  switch (node.type) {
    case "group":
      return "canvasNode.groupPlaceholder";
    case "link":
      return "canvasNode.linkPlaceholder";
    default:
      return "canvasNode.textPlaceholder";
  }
}
