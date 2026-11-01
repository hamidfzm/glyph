import { invoke } from "@tauri-apps/api/core";

/**
 * Whether another window already shows `path`, raising it when `focus` is set.
 * Fails open: a backend hiccup degrades to not knowing, rather than refusing to
 * open or save anything.
 */
export async function shownInAnotherWindow(
  path: string,
  { focus }: { focus: boolean },
): Promise<boolean> {
  try {
    return await invoke<boolean>("window_showing_file", { path, focus });
  } catch {
    return false;
  }
}
