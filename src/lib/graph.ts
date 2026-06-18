// Builds the workspace graph model for the graph view (#185): one node per
// markdown file, one edge per resolved wikilink. Pure data — rendering and
// layout live elsewhere. Resolution reuses the wikilink resolver so the graph
// always agrees with what clicking a link in a document would do.

import type { WikilinkRef } from "./backlinks";
import { dirOf, resolveWikilink, stemOf } from "./wikilinkResolver";

export interface GraphNode {
  /** Absolute file path — the unique node id. */
  id: string;
  /** File basename without extension. */
  label: string;
  /** True when no resolved link points into or out of this file. */
  orphan: boolean;
  /** Number of distinct neighbors; drives node sizing. */
  degree: number;
}

export interface GraphEdge {
  /** Source file path (the file containing the wikilink). */
  source: string;
  /** Resolved target file path. */
  target: string;
}

export interface WorkspaceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Undirected adjacency: node id -> ids of its direct neighbors. */
  neighbors: Map<string, ReadonlySet<string>>;
}

const EMPTY_GRAPH: WorkspaceGraph = { nodes: [], edges: [], neighbors: new Map() };

/**
 * Derive the {nodes, edges} graph from the workspace file index and the flat
 * wikilink scan. Broken links (unresolvable targets) and self-links are
 * dropped; parallel links between the same pair collapse into one edge.
 *
 * Resolution results are memoised per (target, source directory) — the only
 * inputs `resolveWikilink` actually depends on — so vaults where many files
 * reference the same hubs stay O(unique targets), not O(refs × files).
 */
export function buildWorkspaceGraph(
  workspaceFiles: readonly string[],
  refs: readonly WikilinkRef[],
): WorkspaceGraph {
  if (workspaceFiles.length === 0) return EMPTY_GRAPH;

  const files = workspaceFiles as string[];
  const fileSet = new Set(files);
  const resolveCache = new Map<string, string | null>();
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const neighbors = new Map<string, Set<string>>();

  for (const ref of refs) {
    if (!fileSet.has(ref.source)) continue;
    // Strip the optional `|alias`, mirroring what the renderer and backlinks
    // panel do before resolving.
    const pipe = ref.target.indexOf("|");
    const target = pipe >= 0 ? ref.target.slice(0, pipe) : ref.target;

    // NUL separator: it can't appear in paths, so keys never collide.
    const cacheKey = `${target}\u0000${dirOf(ref.source)}`;
    let resolved = resolveCache.get(cacheKey);
    if (resolved === undefined) {
      resolved = resolveWikilink(target, files, ref.source).path;
      resolveCache.set(cacheKey, resolved);
    }
    if (resolved === null || resolved === ref.source) continue;

    const edgeKey = `${ref.source}\u0000${resolved}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    edges.push({ source: ref.source, target: resolved });

    let forward = neighbors.get(ref.source);
    if (!forward) {
      forward = new Set();
      neighbors.set(ref.source, forward);
    }
    forward.add(resolved);
    let backward = neighbors.get(resolved);
    if (!backward) {
      backward = new Set();
      neighbors.set(resolved, backward);
    }
    backward.add(ref.source);
  }

  const nodes: GraphNode[] = files.map((path) => {
    const degree = neighbors.get(path)?.size ?? 0;
    return { id: path, label: stemOf(path), orphan: degree === 0, degree };
  });

  return { nodes, edges, neighbors };
}
