// The workspace index, as the Rust `vault` module hands it over. These types
// mirror `src-tauri/src/vault/snapshot.rs` and `queries.rs`; nothing here
// derives link resolution, tags, or the graph, because those answers arrive
// already computed and a second implementation is exactly what #223 removed.

import type { ScanStatus } from "@/lib/workspaceScan";

export interface NoteSummary {
  path: string;
  title: string | null;
  /** Frontmatter and inline tags, normalized, deduplicated and sorted. */
  tags: string[];
  /** Frontmatter fields by lowercased name, `tags` excluded. */
  fields: Record<string, string>;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface GraphNode {
  /** Absolute file path, the unique node id. */
  id: string;
  /** File name without its extension. */
  label: string;
  /** Number of distinct neighbours, in either direction. */
  degree: number;
  orphan: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface Backlink {
  source: string;
  line: number;
  snippet: string;
}

export interface UnresolvedLink {
  source: string;
  /** Target as written, with `|alias` and `#heading` already removed. */
  target: string;
  line: number;
}

export interface VaultSnapshot {
  /** Every indexed path: markdown and canvas, sorted. */
  files: string[];
  /** Notes carrying at least one tag or frontmatter field. */
  notes: NoteSummary[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  tagCounts: TagCount[];
  /** Every frontmatter field name used anywhere in the workspace. */
  fieldNames: string[];
  unresolved: UnresolvedLink[];
  /** Notes with no outgoing resolved link. */
  deadEnds: string[];
  status: ScanStatus;
}

export interface VaultQueryResult {
  filters: Array<{ field: string; value: string }>;
  /** The query minus its filters. */
  text: string;
  /** Paths satisfying every filter, or every indexed path when there are none. */
  paths: string[];
}

export const EMPTY_SNAPSHOT: VaultSnapshot = {
  files: [],
  notes: [],
  graph: { nodes: [], edges: [] },
  tagCounts: [],
  fieldNames: [],
  unresolved: [],
  deadEnds: [],
  status: { truncated: false, reason: null, limit: null },
};
