// Filters a flat list of wikilink references (produced by the Rust
// `scan_wikilinks` command) down to those that resolve to the currently-open
// file, using the same resolver that powers Phase 1 rendering. Self-links —
// where the source file is the current file — are dropped so the panel only
// surfaces *inbound* links from elsewhere in the workspace.
import { resolveWikilink } from "./wikilinkResolver";

export interface WikilinkRef {
  source: string;
  target: string;
  line: number;
  snippet: string;
}

export interface Backlink {
  source: string;
  line: number;
  snippet: string;
}

export function filterBacklinks(
  refs: readonly WikilinkRef[],
  workspaceFiles: readonly string[],
  currentFilePath: string,
): Backlink[] {
  if (!currentFilePath || workspaceFiles.length === 0) return [];

  const out: Backlink[] = [];
  const files = workspaceFiles as string[];
  for (const ref of refs) {
    if (ref.source === currentFilePath) continue;
    // Strip the optional `|alias` — the resolver only cares about the target
    // and heading (matches what remarkWikilink does at parse time).
    const pipe = ref.target.indexOf("|");
    const target = pipe >= 0 ? ref.target.slice(0, pipe) : ref.target;
    const resolved = resolveWikilink(target, files, ref.source);
    if (resolved.path === currentFilePath) {
      out.push({ source: ref.source, line: ref.line, snippet: ref.snippet });
    }
  }

  // Stable order: by source filename, then line.
  out.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line);
  return out;
}
