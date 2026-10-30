import { describe, expect, it } from "vitest";
import { conformToDefaults } from "./settingsConform";

describe("conformToDefaults", () => {
  it("keeps values of the default's type", () => {
    const stored = { appearance: { theme: "dark", fontSize: 18 }, behavior: { autoSave: false } };
    expect(conformToDefaults(stored)).toEqual(stored);
  });

  it("drops a value of another type so the default applies", () => {
    expect(
      conformToDefaults({
        appearance: { fontSize: "huge", theme: "dark" },
        editor: "vim",
        behavior: { autoSave: 1, recentFiles: "C:/a.md" },
      }),
    ).toEqual({ appearance: { theme: "dark" }, behavior: {} });
  });

  it("keeps keys the schema does not know", () => {
    const stored = { appearance: { newerSetting: 3 }, futureGroup: { x: true } };
    expect(conformToDefaults(stored)).toEqual(stored);
  });

  it("drops array items of another type than the default's", () => {
    expect(conformToDefaults({ editor: { spellCheckLanguages: ["en", 4, "fa", null] } })).toEqual({
      editor: { spellCheckLanguages: ["en", "fa"] },
    });
    const tabs = [{ kind: "file", path: "C:/a.md" }];
    expect(conformToDefaults({ behavior: { openTabs: tabs } })).toEqual({
      behavior: { openTabs: tabs },
    });
  });

  it("checks the values of maps keyed by free-form ids", () => {
    expect(
      conformToDefaults({
        keybindings: { overrides: { save: "Mod+S", find: 7 } },
        ai: { agentWriteTools: { patch_note: true, rename_note: "yes" }, apiKeys: [] },
        layout: {
          blocks: {
            files: { height: 100, collapsed: false },
            outline: { height: null, collapsed: true },
            bad: 3,
            half: { height: "tall", collapsed: true },
          },
        },
      }),
    ).toEqual({
      keybindings: { overrides: { save: "Mod+S" } },
      ai: { agentWriteTools: { patch_note: true } },
      layout: {
        blocks: {
          files: { height: 100, collapsed: false },
          outline: { height: null, collapsed: true },
        },
      },
    });
  });

  it("keeps a choice made for a setting whose default is unset", () => {
    expect(
      conformToDefaults({
        ai: { assistantTools: { claude: true, openai: null, ollama: false, other: "yes" } },
      }),
    ).toEqual({ ai: { assistantTools: { claude: true, openai: null, ollama: false } } });
  });

  it("drops keys that would replace an object's prototype", () => {
    const stored = JSON.parse(
      '{"__proto__":{"x":1},"appearance":{"__proto__":{"theme":"dark"},"theme":"light"},"keybindings":{"overrides":{"constructor":"a","save":"Mod+S"}}}',
    );
    const result = conformToDefaults(stored);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.appearance)).toBe(Object.prototype);
    expect(result).toEqual({
      appearance: { theme: "light" },
      keybindings: { overrides: { save: "Mod+S" } },
    });
  });
});
