import { invoke } from "@tauri-apps/api/core";
import { wikilinkTargets } from "@/lib/wikilinkNodes";

/** Shared, so a document without wikilinks never re-renders on a new map. */
export const NO_RESOLUTIONS: ReadonlyMap<string, string | null> = new Map();

/** Where each of `targets` points, keyed as written. `from` decides
 *  same-directory ties; an unsaved document has no directory to prefer. */
export async function resolvePaths(
  root: string,
  from: string | undefined,
  targets: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  if (targets.length === 0) return NO_RESOLUTIONS;
  const paths = await invoke<(string | null)[]>("vault_resolve", {
    root,
    from: from ?? null,
    targets,
  });
  return new Map(targets.map((target, i) => [target, paths[i] ?? null]));
}

/** Where every wikilink in `content` points. `useWikilinkResolutions` is the
 *  React face of this; the site exporter renders outside React and awaits it. */
export function resolveTargets(
  root: string,
  filePath: string | undefined,
  content: string,
): Promise<ReadonlyMap<string, string | null>> {
  return resolvePaths(root, filePath, wikilinkTargets(content));
}
