import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HELP_LINKS, openDocumentation, openReleaseNotes, openReportIssue } from "./helpLinks";

beforeEach(() => {
  vi.mocked(openUrl).mockClear();
});

describe("helpLinks", () => {
  it("opens the documentation URL", () => {
    openDocumentation();
    expect(openUrl).toHaveBeenCalledWith(HELP_LINKS.documentation);
  });

  it("opens the release-notes URL", () => {
    openReleaseNotes();
    expect(openUrl).toHaveBeenCalledWith(HELP_LINKS.releaseNotes);
  });

  it("opens the report-issue URL", () => {
    openReportIssue();
    expect(openUrl).toHaveBeenCalledWith(HELP_LINKS.reportIssue);
  });
});
