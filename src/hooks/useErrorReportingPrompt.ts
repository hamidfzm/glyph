import { useCallback } from "react";
import { useSettings } from "@/hooks/useSettings";
import { isPrimaryWindow } from "@/lib/windowContext";

/**
 * Drives the one-time "enable crash reporting?" banner. It waits until the
 * default-app prompt has been answered so first-run banners appear one at a
 * time, and either answer here stops it permanently.
 */
export function useErrorReportingPrompt() {
  const { settings, updateSettings, loaded } = useSettings();

  const show =
    loaded &&
    isPrimaryWindow() &&
    settings.privacy.errorReportingPrompt === "unanswered" &&
    !settings.privacy.errorReporting &&
    settings.behavior.defaultAppPrompt !== "unanswered";

  const enable = useCallback(() => {
    updateSettings("privacy.errorReporting", true);
    updateSettings("privacy.errorReportingPrompt", "enabled");
  }, [updateSettings]);

  const decline = useCallback(
    () => updateSettings("privacy.errorReportingPrompt", "declined"),
    [updateSettings],
  );

  return { show, enable, decline };
}
