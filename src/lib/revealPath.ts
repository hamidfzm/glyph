import { invoke } from "@tauri-apps/api/core";

// Through the backend, which checks the grants first: the opener plugin's own
// reveal command resolves any path it is given. Best-effort: a file that is
// gone or a path the backend refuses leaves the gesture nothing to recover.
export function revealPath(path: string): void {
  invoke("reveal_path", { path }).catch(() => undefined);
}
