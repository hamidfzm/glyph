import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { adaptMmdContent } from "@/lib/mmd";
import { isMobilePlatform } from "@/lib/platform";
import type { FileMetadata } from "@/lib/tabs";

/** Read a document off disk, adapting `.mmd` Mermaid sources for the markdown renderer. */
export async function loadFileContent(path: string): Promise<{
  content: string;
  metadata: FileMetadata | null;
}> {
  // Mobile pickers hand back sandboxed URIs (content:// on Android) that the
  // Rust fs commands cannot open; only the fs plugin's native layer can, and
  // metadata (and therefore file watching) doesn't apply to them.
  const [raw, metadata] = isMobilePlatform()
    ? [await readTextFile(path), null]
    : await Promise.all([
        invoke<string>("read_file", { path }),
        invoke<FileMetadata>("get_file_metadata", { path }),
      ]);
  // `.mmd` files double as Mermaid diagram source; the adapter fence-wraps them
  // so the markdown renderer turns the body into a diagram. Source documents
  // such as `.d2` keep their raw body and are fenced at render time instead.
  const content = adaptMmdContent(path, raw);
  return { content, metadata };
}
