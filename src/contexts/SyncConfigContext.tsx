import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useSyncConfig } from "@/hooks/useSyncConfig";
import { useTabsContext } from "./TabsContext";

// Single source of truth for the active workspace's sync config. Both the
// status-bar pill and the Cloud Sync modal read from here, so enabling /
// disabling sync (or running one) in the modal is reflected on the pill
// immediately — they share one `useSyncConfig` instance instead of each
// holding a stale copy.

type SyncConfigApi = ReturnType<typeof useSyncConfig>;

export interface SyncConfigContextValue extends SyncConfigApi {
  /** Active folder workspace root, or null when no folder tab is active. */
  workspacePath: string | null;
}

export const SyncConfigContext = createContext<SyncConfigContextValue | null>(null);

export function SyncConfigProvider({ children }: { children: ReactNode }) {
  const { workspace } = useTabsContext();
  const workspacePath = workspace?.root ?? null;
  const sync = useSyncConfig(workspacePath);

  const value = useMemo<SyncConfigContextValue>(
    () => ({ ...sync, workspacePath }),
    [sync, workspacePath],
  );

  return <SyncConfigContext.Provider value={value}>{children}</SyncConfigContext.Provider>;
}

export function useSyncConfigContext(): SyncConfigContextValue {
  const ctx = useContext(SyncConfigContext);
  if (!ctx) throw new Error("useSyncConfigContext must be used inside <SyncConfigProvider>");
  return ctx;
}
