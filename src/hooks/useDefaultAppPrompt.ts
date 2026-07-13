import { useCallback } from "react";
import { useSettings } from "@/hooks/useSettings";
import { setDefaultMarkdownApp } from "@/lib/defaultApp";
import { isPrimaryWindow } from "@/lib/windowContext";

/**
 * Drives the one-time "make Glyph your default Markdown app?" banner. It shows
 * once, only in the primary window and only while the stored answer is
 * "unanswered", so any choice stops it from appearing again. The Settings action
 * stays available regardless.
 */
export function useDefaultAppPrompt() {
  const { settings, updateSettings, loaded } = useSettings();

  const show = loaded && isPrimaryWindow() && settings.behavior.defaultAppPrompt === "unanswered";

  const setDefault = useCallback(() => {
    updateSettings("behavior.defaultAppPrompt", "set");
    void setDefaultMarkdownApp();
  }, [updateSettings]);

  const notNow = useCallback(
    () => updateSettings("behavior.defaultAppPrompt", "notNow"),
    [updateSettings],
  );

  const never = useCallback(
    () => updateSettings("behavior.defaultAppPrompt", "never"),
    [updateSettings],
  );

  return { show, setDefault, notNow, never };
}
