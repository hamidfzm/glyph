// Turns the flat tag list into the nesting `/` implies, so `project/glyph`
// hangs under `project` instead of sitting beside it as a long chip.

import type { TagCount } from "@/lib/metadata";

export type TagSort = "name" | "count";

export interface TagNode {
  /** Full tag path, which is what selecting the node filters by. */
  tag: string;
  /** Last path segment: what the chip shows once the parent is above it. */
  label: string;
  /** Files carrying this tag or any tag nested under it. */
  count: number;
  children: TagNode[];
}

const byName = (a: TagNode, b: TagNode) => a.tag.localeCompare(b.tag);
const byCount = (a: TagNode, b: TagNode) => b.count - a.count || byName(a, b);

function sortLevels(nodes: TagNode[], compare: (a: TagNode, b: TagNode) => number): void {
  nodes.sort(compare);
  for (const node of nodes) sortLevels(node.children, compare);
}

/**
 * `tags` is expected to carry every ancestor already, which `tagCounts` does;
 * a node whose parent is missing stays at the root under its full path.
 */
export function buildTagTree(tags: readonly TagCount[], sort: TagSort): TagNode[] {
  const nodes = new Map<string, TagNode>();
  for (const { tag, count } of tags) {
    nodes.set(tag, { tag, label: tag, count, children: [] });
  }

  const roots: TagNode[] = [];
  for (const node of nodes.values()) {
    const separator = node.tag.lastIndexOf("/");
    const parent = separator === -1 ? undefined : nodes.get(node.tag.slice(0, separator));
    if (!parent) {
      roots.push(node);
      continue;
    }
    // The parent chip carries the prefix, so the child only shows its tail.
    node.label = node.tag.slice(separator + 1);
    parent.children.push(node);
  }

  sortLevels(roots, sort === "name" ? byName : byCount);
  return roots;
}
