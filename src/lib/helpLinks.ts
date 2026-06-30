import { openUrl } from "@tauri-apps/plugin-opener";

// External Help-menu destinations, opened in the user's default browser via the
// opener plugin when the matching native menu item fires. Kept out of AppShell
// so the wiring there stays a thin map of stable handler references.
export const HELP_LINKS = {
  documentation: "https://github.com/hamidfzm/glyph#readme",
  releaseNotes: "https://github.com/hamidfzm/glyph/releases",
  reportIssue: "https://github.com/hamidfzm/glyph/issues/new/choose",
} as const;

export function openDocumentation() {
  void openUrl(HELP_LINKS.documentation);
}

export function openReleaseNotes() {
  void openUrl(HELP_LINKS.releaseNotes);
}

export function openReportIssue() {
  void openUrl(HELP_LINKS.reportIssue);
}
