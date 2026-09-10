import { pathStem } from "@/lib/paths";
import type { VaultSnapshot } from "@/lib/vault";

// A workspace graph shaped the way the Rust index hands it over. Which links
// exist and which resolve is decided there and tested there; this only spells
// out the answer so the renderer and the simulation have something to draw.

type WorkspaceGraph = VaultSnapshot["graph"];

/** `files` as nodes, `edges` as resolved links between them. */
export function graphOf(files: string[], edges: Array<[string, string]> = []): WorkspaceGraph {
  const neighbors = new Map(files.map((file) => [file, new Set<string>()]));
  for (const [source, target] of edges) {
    neighbors.get(source)?.add(target);
    neighbors.get(target)?.add(source);
  }
  return {
    nodes: files.map((id) => {
      const degree = neighbors.get(id)?.size ?? 0;
      return { id, label: pathStem(id), degree, orphan: degree === 0 };
    }),
    edges: edges.map(([source, target]) => ({ source, target })),
  };
}
