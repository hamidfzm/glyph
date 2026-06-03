import { useCallback, useEffect, useRef, useState } from "react";
import { type AvailableUpdate, checkForUpdate } from "@/lib/updateCheck";

export interface UpdateCheckState {
  // The newer release to advertise, or null when up to date / not yet checked.
  update: AvailableUpdate | null;
  // Hide the banner for the rest of this session.
  dismiss: () => void;
}

/**
 * Run a single background update check once settings have loaded and the
 * feature is enabled, surfacing a newer release for the banner to show.
 *
 * The check fires at most once per app session (guarded by a ref, which also
 * absorbs React StrictMode's double-invoke), not on every settings change or
 * re-render. Failures and "already up to date" results leave `update` null so
 * nothing is shown. Manual re-checks live in the settings UI, not here.
 */
export function useUpdateCheck(enabled: boolean, loaded: boolean): UpdateCheckState {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!loaded || !enabled || checkedRef.current) return;
    checkedRef.current = true;

    let active = true;
    void checkForUpdate().then((result) => {
      if (active && result.status === "available") {
        setUpdate({
          latestVersion: result.latestVersion,
          currentVersion: result.currentVersion,
          url: result.url,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [enabled, loaded]);

  const dismiss = useCallback(() => setUpdate(null), []);

  return { update, dismiss };
}
