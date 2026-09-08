import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { VaultSnapshot } from "@/lib/vault";

const NONE: string[] = [];

/**
 * Files carrying `tag` or one of its nested children (`work/urgent`).
 *
 * Asked of the index rather than derived from the snapshot's per-note tags:
 * which tags a nested one implies is a rule, and the point of moving the index
 * to Rust was to stop that rule having two implementations.
 */
export function useTaggedPaths(
  root: string | undefined,
  tag: string | null,
  snapshot: VaultSnapshot,
): string[] {
  const [paths, setPaths] = useState<string[]>(NONE);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the re-ask trigger, not a value read; a new index is exactly when the answer can differ
  useEffect(() => {
    if (!root || !tag) {
      setPaths(NONE);
      return;
    }
    let current = true;
    invoke<string[]>("vault_paths_with_tag", { root, tag })
      .then((rows) => {
        if (current) setPaths(rows);
      })
      .catch((err) => {
        console.error(`Failed to list files tagged ${tag}:`, err);
        if (current) setPaths(NONE);
      });
    return () => {
      current = false;
    };
  }, [root, tag, snapshot]);

  return paths;
}
