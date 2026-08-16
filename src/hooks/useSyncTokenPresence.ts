import { useCallback, useEffect, useRef, useState } from "react";
import { hasSyncToken } from "@/lib/syncCommands";

/** `undefined` is "not checked yet" and `null` is "the check failed" or "no
 *  workspace open"; neither may be rendered as "not set". A locked keychain
 *  must not report a stored token as gone. */
export type TokenPresence = boolean | null | undefined;

export interface UseSyncTokenPresenceReturn {
  tokenStored: TokenPresence;
  /** Re-read after a write, so the row reflects what the keychain now holds. */
  refresh: () => Promise<void>;
}

/**
 * Whether this workspace has a sync token in the OS keychain. Presence is all
 * the renderer can learn: sync tokens are off the webview secret allowlist on
 * purpose, so the value itself is never fetched here.
 */
export function useSyncTokenPresence(
  workspacePath: string | null | undefined,
): UseSyncTokenPresenceReturn {
  const [tokenStored, setTokenStored] = useState<TokenPresence>(undefined);
  // The workspace this hook is currently answering for. A lookup that resolves
  // after a switch is compared against it and dropped, so the previous folder's
  // answer can never land on the new one.
  const activeRef = useRef(workspacePath);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setTokenStored(null);
      return;
    }
    setTokenStored(undefined);
    try {
      const isSet = await hasSyncToken(workspacePath);
      if (activeRef.current === workspacePath) setTokenStored(isSet);
    } catch (err) {
      console.error("Failed to check the sync token:", err);
      if (activeRef.current === workspacePath) setTokenStored(null);
    }
  }, [workspacePath]);

  useEffect(() => {
    activeRef.current = workspacePath;
    refresh();
  }, [refresh, workspacePath]);

  return { tokenStored, refresh };
}
