import { invoke } from "@tauri-apps/api/core";

/** Whether something Glyph may read is at `path`. */
export function fileExists(path: string): Promise<boolean> {
  return invoke("check_path_exists", { path }).then(
    () => true,
    () => false,
  );
}
