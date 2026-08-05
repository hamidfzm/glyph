import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { adaptD2Content } from "@/lib/d2Extensions";
import { adaptMmdContent } from "@/lib/mmd";
import { isMobilePlatform } from "@/lib/platform";
import type { FileMetadata } from "@/lib/tabs";

/** Read a document off disk, adapting diagram sources for the markdown renderer. */
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
  // `.mmd` files double as Mermaid diagram source; `.d2` files are D2 diagram
  // source. Each adapter fence-wraps its own extension so the existing markdown
  // renderer turns the body into a diagram, and is a no-op for other paths.
  const content = adaptD2Content(path, adaptMmdContent(path, raw));
  return { content, metadata };
}
