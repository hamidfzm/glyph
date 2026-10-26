import type { TFunction } from "i18next";

// The settings repo holds `settings/<group>.json` and `plugins/<id>.json`.
// Conflicts and skipped files are named in the user's words, not as paths.

/** Settings groups by the Settings tab that shows them. */
const GROUP_TABS: Record<string, string> = {
  appearance: "appearance",
  layout: "layout",
  behavior: "behavior",
  keybindings: "hotkeys",
  editor: "editor",
  markdown: "markdown",
  print: "print",
  ai: "ai",
  corePlugins: "plugins",
};

const FILE = /^(settings|plugins)\/([^/]+)\.json$/;

/** A repo path as the Sync tab names it. */
export function describeSyncFile(
  path: string,
  t: TFunction<"sync">,
  ts: TFunction<"settings">,
): string {
  const match = FILE.exec(path);
  if (!match) return path;
  const [, folder, name] = match;
  if (folder === "plugins") return t("settingsRepo.files.plugin", { id: name });
  const tab = GROUP_TABS[name];
  if (!tab) return path;
  return t("settingsRepo.files.settings", { group: ts(`modal.tabs.${tab}`) });
}
