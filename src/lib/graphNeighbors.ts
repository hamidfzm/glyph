import type { GraphEdge } from "@/lib/vault";

/**
 * Undirected adjacency over the edges the index resolved, so hovering a node
 * can dim everything it does not touch without scanning every edge per frame.
 * Decides nothing: which links exist and which collapse into one edge are
 * settled in Rust.
 */
export function neighborIndex(edges: readonly GraphEdge[]): Map<string, ReadonlySet<string>> {
  const neighbors = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    let set = neighbors.get(from);
    if (!set) {
      set = new Set();
      neighbors.set(from, set);
    }
    set.add(to);
  };

  for (const edge of edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  return neighbors;
}
