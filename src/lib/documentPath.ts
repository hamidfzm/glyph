import { invoke } from "@tauri-apps/api/core";
import { isMobilePlatform } from "@/lib/platform";

/**
 * The backend's spelling of `path`, the one every tab holds, so that comparing
 * two paths as strings answers whether they name one file. Mobile picker URIs
 * are out of reach of the Rust commands. A path the backend refuses comes back
 * as given: the read or write that follows is what reports the refusal.
 */
export async function documentPath(path: string): Promise<string> {
  if (isMobilePlatform()) return path;
  try {
    return await invoke<string>("document_path", { path });
  } catch {
    return path;
  }
}
