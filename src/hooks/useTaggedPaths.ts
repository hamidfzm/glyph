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
  const [answered, setAnswered] = useState<{ key: string; rows: string[] }>({
    key: "",
    rows: NONE,
  });
  const key = `${root ?? ""}\u0000${tag ?? ""}`;

  useEffect(() => {
    // An empty index carries no tags, so there is nothing to ask about.
    // Reading the snapshot here is also what makes it a dependency: which
    // files carry a tag changes every time the index does.
    if (!root || !tag || snapshot.files.length === 0) {
      setAnswered({ key, rows: NONE });
      return;
    }
    let current = true;
    invoke<string[]>("vault_paths_with_tag", { root, tag })
      .then((rows) => {
        if (current) setAnswered({ key, rows });
      })
      .catch((err) => {
        console.error(`Failed to list files tagged ${tag}:`, err);
        if (current) setAnswered({ key, rows: NONE });
      });
    return () => {
      current = false;
    };
  }, [root, tag, key, snapshot]);

  // Stamped with the tag they answer, so picking another chip empties the list
  // for one round trip rather than showing the previous tag's files under it.
  return answered.key === key ? answered.rows : NONE;
}
