import { useCallback, useRef, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { type DefaultAppOutcome, setDefaultMarkdownApp } from "@/lib/defaultApp";
import { isMobilePlatform } from "@/lib/platform";
import { isPrimaryWindow } from "@/lib/windowContext";

/**
 * Drives the first-run "make Glyph your default Markdown app?" banner. It shows
 * only in the primary window and only while the stored answer is "unanswered".
 * "Not now", "Never" and a "Set as default" the platform took all answer it. One
 * that set nothing stays up as `outcome` until dismissed, and only a failure
 * leaves the question for the next launch. The Settings action stays available
 * regardless.
 */
export function useDefaultAppPrompt() {
  const { settings, updateSettings, loaded } = useSettings();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DefaultAppOutcome | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const promptRef = useRef(settings.behavior.defaultAppPrompt);
  promptRef.current = settings.behavior.defaultAppPrompt;

  // Default-app registration is a desktop concept; mobile never prompts.
  const show =
    loaded &&
    !dismissed &&
    !isMobilePlatform() &&
    isPrimaryWindow() &&
    settings.behavior.defaultAppPrompt === "unanswered";

  const setDefault = useCallback(async () => {
    setBusy(true);
    const result = await setDefaultMarkdownApp();
    setBusy(false);
    // "Not now" or "Never" clicked while the command ran is the newer answer.
    if (promptRef.current !== "unanswered") return;
    if (result === "registered" || result === "openedSettings") {
      updateSettings("behavior.defaultAppPrompt", "set");
      return;
    }
    setOutcome(result);
  }, [updateSettings]);

  const dismissOutcome = useCallback(() => {
    setOutcome(null);
    // A failure may not repeat, so it stays unanswered and asks again next launch.
    if (outcome === "error") {
      setDismissed(true);
      return;
    }
    updateSettings("behavior.defaultAppPrompt", "guided");
  }, [outcome, updateSettings]);

  const notNow = useCallback(
    () => updateSettings("behavior.defaultAppPrompt", "notNow"),
    [updateSettings],
  );

  const never = useCallback(
    () => updateSettings("behavior.defaultAppPrompt", "never"),
    [updateSettings],
  );

  return { show, busy, outcome, setDefault, dismissOutcome, notNow, never };
}
