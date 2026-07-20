import { invoke } from "@tauri-apps/api/core";

// Session cache for hover-preview reads: peeking the same note repeatedly while
// browsing would otherwise cost a Rust round-trip each time. Failed reads are
// evicted so a transient error doesn't poison the entry (as in d2Render).
const cache = new Map<string, Promise<string>>();

export function readNoteCached(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit) return hit;
  const pending = invoke<string>("read_file", { path });
  cache.set(path, pending);
  pending.catch(() => cache.delete(path));
  return pending;
}
