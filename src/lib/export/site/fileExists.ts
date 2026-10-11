import { invoke } from "@tauri-apps/api/core";

/** Whether something Glyph may read is at `path`. */
export function fileExists(path: string): Promise<boolean> {
  return invoke("get_file_metadata", { path }).then(
    () => true,
    () => false,
  );
}
