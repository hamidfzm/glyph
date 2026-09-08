import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useVaultSnapshot, useWorkspaceRoot } from "@/contexts/TabsContext";
import type { VaultQueryResult } from "@/lib/vault";

/** No filters yet parsed: the whole query is still plain search text. */
function plain(query: string): VaultQueryResult {
  return { filters: [], text: query, paths: [] };
}

/**
 * A palette query split into its metadata filters and the leftover search
 * text, with the paths the filters select.
 *
 * The grammar lives in Rust so the palette and the index agree on what
 * `tag:foo` means. That makes it asynchronous, so the previous answer stays on
 * screen while the next one loads: the alternative is the list emptying for a
 * frame on every keystroke.
 */
export function useVaultQuery(query: string): VaultQueryResult {
  const root = useWorkspaceRoot();
  const snapshot = useVaultSnapshot();
  const [result, setResult] = useState<VaultQueryResult>(() => plain(query));

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the re-ask trigger, not a value read; a new index is exactly when the answer can differ
  useEffect(() => {
    if (!root) {
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
  }, [root, query, snapshot]);

  return result;
}
