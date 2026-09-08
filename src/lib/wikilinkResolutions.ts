import { invoke } from "@tauri-apps/api/core";
import { wikilinkTargets } from "@/lib/wikilinkNodes";

/** Nothing to resolve, shared so a document without wikilinks never re-renders
 *  on a new empty map. */
export const NO_RESOLUTIONS: ReadonlyMap<string, string | null> = new Map();

/**
 * Ask the index where each of `targets` points, keyed as written.
 *
 * `from` decides same-directory ties; a document with no path on disk yet has
 * no directory to prefer.
 */
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

/**
 * Where every wikilink in `content` points.
 *
 * The markdown pipeline resolves nothing itself, so each caller resolves up
 * front and hands the answers in. `useWikilinkResolutions` is the React face of
 * this; the site exporter renders outside React and awaits it directly.
 */
export function resolveTargets(
  root: string,
  filePath: string | undefined,
  content: string,
): Promise<ReadonlyMap<string, string | null>> {
  return resolvePaths(root, filePath, wikilinkTargets(content));
}
