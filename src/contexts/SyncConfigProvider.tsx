import { type ReactNode, useMemo } from "react";
import { useSyncConfig } from "@/hooks/useSyncConfig";
import { SyncConfigContext, type SyncConfigContextValue } from "./SyncConfigContext";
import { useTabsContext } from "./TabsContext";

// Single source of truth for the active workspace's sync config. Both the
// status-bar pill and the Cloud Sync modal read from here, so enabling /
// disabling sync (or running one) in the modal is reflected on the pill
// immediately — they share one `useSyncConfig` instance instead of each
// holding a stale copy.
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
