import { invoke } from "@tauri-apps/api/core";

// Mirrors the Rust `search_workspace` command in
// `src-tauri/src/commands/search.rs`.

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchMatch {
  /** 1-based line number in the source file. */
  line: number;
  /** Byte offset within the line; `line:column` is a match's stable identity. */
  column: number;
  before: string;
  /** The matched fragment, rendered highlighted. */
  text: string;
  after: string;
}

export interface FileMatches {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResults {
  files: FileMatches[];
  total: number;
  /** True when a cap cut the scan short and the query needs narrowing. */
  truncated: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export const EMPTY_SEARCH_RESULTS: SearchResults = { files: [], total: 0, truncated: false };

export function searchWorkspace(
  path: string,
  query: string,
  options: SearchOptions,
): Promise<SearchResults> {
  return invoke<SearchResults>("search_workspace", { path, query, options });
}
