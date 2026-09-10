import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { Backlink, VaultSnapshot } from "@/lib/vault";

const NONE: Backlink[] = [];

/**
 * Inbound links to `path`. Asked per note rather than shipped with the
 * snapshot: a workspace has far more links than files, and each carries a
 * snippet of up to 200 characters.
 */
export function useBacklinks(
  root: string | undefined,
  path: string | undefined,
  snapshot: VaultSnapshot,
): Backlink[] {
  const [answered, setAnswered] = useState<{ key: string; rows: Backlink[] }>({
    key: "",
    rows: NONE,
  });
  const key = `${root ?? ""}\u0000${path ?? ""}`;

  useEffect(() => {
    // An empty index has nothing pointing anywhere.
    if (!root || !path || snapshot.files.length === 0) {
      setAnswered({ key, rows: NONE });
      return;
    }
    let current = true;
    invoke<Backlink[]>("vault_backlinks", { root, path })
      .then((rows) => {
        if (current) setAnswered({ key, rows });
      })
      .catch((err) => {
        console.error(`Failed to read backlinks for ${path}:`, err);
        if (current) setAnswered({ key, rows: NONE });
      });
    return () => {
      current = false;
    };
  }, [root, path, key, snapshot]);

  // Stamped with the note they answer: switching notes empties the panel for
  // one round trip rather than showing the last note's links under the new one.
  return answered.key === key ? answered.rows : NONE;
}
