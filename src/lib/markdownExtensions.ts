// Single source of truth — shared with the Rust backend via
// `include_str!("../../markdown-extensions.json")` in src-tauri/src/lib.rs.
// Update the JSON file; both sides pick up the change.
import extensions from "../../markdown-extensions.json";

export const MARKDOWN_EXTENSIONS: readonly string[] = extensions;

export function isMarkdownFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? MARKDOWN_EXTENSIONS.includes(ext) : false;
}
