import { invoke } from "@tauri-apps/api/core";
import { wikilinkTargets } from "@/lib/wikilinkNodes";

/**
 * Ask the index where every wikilink in `content` points, keyed as written.
 *
 * The markdown pipeline resolves nothing itself, so each caller resolves up
 * front and hands the answers in. `useWikilinkResolutions` is the React face of
 * this; the site exporter renders outside React and awaits it directly.
 */
export async function resolveTargets(
  root: string,
  filePath: string,
  content: string,
): Promise<ReadonlyMap<string, string | null>> {
  const targets = wikilinkTargets(content);
  if (targets.length === 0) return new Map();
  const paths = await invoke<(string | null)[]>("vault_resolve", {
    root,
    from: filePath,
    targets,
  });
  return new Map(targets.map((target, i) => [target, paths[i] ?? null]));
}
