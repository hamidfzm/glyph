import { describe, expect, it } from "vitest";
import { i18n } from "@/lib/i18n";
import { describeSyncFile } from "./settingsSyncFiles";

describe("describeSyncFile", () => {
  const t = i18n.getFixedT("en", "sync");
  const ts = i18n.getFixedT("en", "settings");

  it("names a settings group by its Settings tab", () => {
    expect(describeSyncFile("settings/appearance.json", t, ts)).toBe("Appearance settings");
    expect(describeSyncFile("settings/keybindings.json", t, ts)).toBe("Hotkeys settings");
    expect(describeSyncFile("settings/corePlugins.json", t, ts)).toBe("Plugins settings");
  });

  it("names a plugin file by the plugin", () => {
    expect(describeSyncFile("plugins/com.x.demo.json", t, ts)).toBe("Plugin com.x.demo");
  });

  it("keeps the path of anything else", () => {
    expect(describeSyncFile("settings/privacy.json", t, ts)).toBe("settings/privacy.json");
    expect(describeSyncFile("notes/a.md", t, ts)).toBe("notes/a.md");
    expect(describeSyncFile("settings", t, ts)).toBe("settings");
  });
});
