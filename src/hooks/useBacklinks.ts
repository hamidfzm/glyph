import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { Backlink, VaultSnapshot } from "@/lib/vault";

const NONE: Backlink[] = [];

/**
 * Inbound links to `path`, with the snippet of the line each came from.
 *
 * Asked per note rather than shipped with the snapshot: a snippet is up to 200
 * characters and a workspace has far more links than files, so carrying them
 * all would make the payload scale with the link count.
 *
 * `snapshot` is a dependency rather than a source: it changes whenever the
 * index does, which is exactly when the answer might differ.
 */
export function useBacklinks(
  root: string | undefined,
  path: string | undefined,
  snapshot: VaultSnapshot,
): Backlink[] {
  const [backlinks, setBacklinks] = useState<Backlink[]>(NONE);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the re-ask trigger, not a value read; a new index is exactly when the answer can differ
  useEffect(() => {
    if (!root || !path) {
      setBacklinks(NONE);
      return;
    }
    let current = true;
    invoke<Backlink[]>("vault_backlinks", { root, path })
      .then((rows) => {
        if (current) setBacklinks(rows);
      })
      .catch((err) => {
        console.error(`Failed to read backlinks for ${path}:`, err);
        if (current) setBacklinks(NONE);
      });
    // A later note's rows must not land after the tab moved on.
    return () => {
      current = false;
    };
  }, [root, path, snapshot]);

  return backlinks;
}
