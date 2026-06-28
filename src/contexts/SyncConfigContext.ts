import { createContext, useContext } from "react";
import type { useSyncConfig } from "@/hooks/useSyncConfig";

// Context + hook for the active workspace's sync config. Kept in a component-free
// module so the provider file stays Fast-Refresh-eligible (a file that exports a
// component plus a hook/context bails out of React Fast Refresh). The provider
// lives in `SyncConfigProvider.tsx`.

type SyncConfigApi = ReturnType<typeof useSyncConfig>;

export interface SyncConfigContextValue extends SyncConfigApi {
  /** Active folder workspace root, or null when no folder tab is active. */
  workspacePath: string | null;
}

export const SyncConfigContext = createContext<SyncConfigContextValue | null>(null);

export function useSyncConfigContext(): SyncConfigContextValue {
  const ctx = useContext(SyncConfigContext);
  if (!ctx) throw new Error("useSyncConfigContext must be used inside <SyncConfigProvider>");
  return ctx;
}
