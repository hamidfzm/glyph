import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { adaptMmdContent } from "@/lib/mmd";
import { isMobilePlatform } from "@/lib/platform";

/** Read a document off disk, adapting `.mmd` Mermaid sources for the markdown renderer. */
export async function loadFileContent(path: string): Promise<string> {
  // Mobile pickers hand back sandboxed URIs (content:// on Android) that the
  // Rust fs commands cannot open; only the fs plugin's native layer can.
  const raw = isMobilePlatform()
    ? await readTextFile(path)
    : await invoke<string>("read_file", { path });
  // `.mmd` files double as Mermaid diagram source; the adapter fence-wraps them
  // so the markdown renderer turns the body into a diagram. Source documents
  // such as `.d2` keep their raw body and are fenced at render time instead.
  return adaptMmdContent(path, raw);
}
