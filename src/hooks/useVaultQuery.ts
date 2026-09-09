import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useVaultSnapshot, useWorkspaceRoot } from "@/contexts/TabsContext";
import type { VaultQueryResult } from "@/lib/vault";

/** No filters yet parsed: the whole query is still plain search text. */
function plain(query: string): VaultQueryResult {
  return { filters: [], text: query, paths: [] };
}

/**
 * A palette query split into its filters and the leftover search text, with
 * the paths the filters select. The grammar lives in Rust so the palette and
 * the index agree on what `tag:foo` means.
 *
 * Unlike the other index hooks the answer is not stamped: emptying the list
 * for a frame on every keystroke is worse than one stale frame. `enabled` is
 * false while the palette is closed, or a hidden one would ask on every
 * re-index for the life of the window.
 */
export function useVaultQuery(query: string, enabled = true): VaultQueryResult {
  const root = useWorkspaceRoot();
  const snapshot = useVaultSnapshot();
  const [result, setResult] = useState<VaultQueryResult>(() => plain(query));

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the re-ask trigger, not a value read: the grammar recognises `field:` only for fields the index knows, so a re-index can change how the same query parses
  useEffect(() => {
    if (!root || !enabled) {
      setResult(plain(query));
      return;
    }
    let current = true;
    invoke<VaultQueryResult>("vault_query", { root, query })
      .then((next) => {
        if (current) setResult(next);
      })
      .catch((err) => {
        console.error(`Failed to run the workspace query ${query}:`, err);
        if (current) setResult(plain(query));
      });
    return () => {
      current = false;
    };
  }, [root, query, enabled, snapshot]);

  return result;
}
