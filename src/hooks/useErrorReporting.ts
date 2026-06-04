import { useEffect } from "react";
import { disableTelemetry, enableTelemetry } from "@/lib/telemetry";

/**
 * Reconcile the Sentry error-reporting opt-in with the SDKs. Runs only once
 * settings have loaded (so we never act on the default before the user's saved
 * choice is known), then enables or disables telemetry whenever the toggle
 * changes. The underlying SDK calls are themselves no-ops in dev builds.
 */
export function useErrorReporting(enabled: boolean, loaded: boolean): void {
  useEffect(() => {
    if (!loaded) return;
    if (enabled) {
      enableTelemetry();
    } else {
      disableTelemetry();
    }
  }, [enabled, loaded]);
}
