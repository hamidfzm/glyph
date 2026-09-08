import type { GraphEdge } from "@/lib/vault";

/**
 * Undirected adjacency over edges the index already resolved, so hovering a
 * node can dim everything it does not touch.
 *
 * This decides nothing about the graph: which links exist, which resolve, and
 * which collapse into one edge are all settled in Rust. It only turns the edge
 * list into a lookup, which would otherwise be a scan per node per frame.
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
