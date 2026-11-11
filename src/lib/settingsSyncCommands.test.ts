import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseSettingsSyncSetup,
  clearSettingsSyncToken,
  connectSettingsSync,
  disconnectSettingsSync,
  getSettingsSyncConfig,
  getSettingsSyncDefaultAuthor,
  getSettingsSyncPluginPlan,
  getSettingsSyncStatus,
  hasSettingsSyncToken,
  resolveSettingsSync,
  runSettingsSync,
  setSettingsSyncToken,
} from "./settingsSyncCommands";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("settings repo commands", () => {
  it("pass no path, only what each command takes", async () => {
    const request = {
      remoteUrl: "https://example.com/setup.git",
      branch: "main",
      author: null,
      token: "t",
    };
    await connectSettingsSync(request);
    await setSettingsSyncToken("t2");
    await chooseSettingsSyncSetup("replace-synced");
    await resolveSettingsSync([{ path: "settings/appearance.json", side: "local" }]);
    await Promise.all([
      getSettingsSyncConfig(),
      hasSettingsSyncToken(),
      clearSettingsSyncToken(),
      getSettingsSyncDefaultAuthor(),
      getSettingsSyncStatus(),
      runSettingsSync(),
      getSettingsSyncPluginPlan(),
      disconnectSettingsSync(),
    ]);

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["settings_sync_connect", request],
      ["settings_sync_set_token", { token: "t2" }],
      ["settings_sync_choose", { choice: "replace-synced" }],
      ["settings_sync_resolve", { picks: [{ path: "settings/appearance.json", side: "local" }] }],
      ["settings_sync_get_config"],
      ["settings_sync_has_token"],
      ["settings_sync_clear_token"],
      ["settings_sync_default_author"],
      ["settings_sync_status"],
      ["settings_sync_run"],
      ["settings_sync_plugin_plan"],
      ["settings_sync_disconnect"],
    ]);
  });
});
