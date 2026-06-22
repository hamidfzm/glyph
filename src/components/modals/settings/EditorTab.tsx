import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import type { EditorKeymap } from "@/lib/settings";
import { Segmented } from "./Segmented";

interface KeymapTip {
  keys?: string;
  textKey: string;
}

// Per-preset cheat sheet shown under the selector. The shortcut strings (`keys`)
// are literal key names and stay untranslated; the prose lives in the settings
// locale under editor.help.* and is resolved at render. Modifier-bearing
// shortcuts are written generically ("Cmd/Ctrl") since the bindings are the same
// across platforms apart from the primary modifier.
const KEYMAP_HELP: Record<EditorKeymap, { titleKey: string; tips: KeymapTip[] }> = {
  default: {
    titleKey: "editor.help.default.title",
    tips: [
      { keys: "[[", textKey: "editor.help.default.autocomplete" },
      { keys: "Tab / Enter", textKey: "editor.help.default.accept" },
      { keys: "Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z", textKey: "editor.help.default.undoRedo" },
      { textKey: "editor.help.default.standard" },
    ],
  },
  vim: {
    titleKey: "editor.help.vim.title",
    tips: [
      { keys: "Esc / i / a / v", textKey: "editor.help.vim.modes" },
      { keys: "w b e 0 $ gg G", textKey: "editor.help.vim.motions" },
      { keys: "d c y p", textKey: "editor.help.vim.operators" },
      { textKey: "editor.help.vim.files" },
    ],
  },
  vscode: {
    titleKey: "editor.help.vscode.title",
    tips: [
      { keys: "Alt+Up / Alt+Down", textKey: "editor.help.vscode.moveLine" },
      { keys: "Shift+Alt+Up / Down", textKey: "editor.help.vscode.copyLine" },
      { keys: "Cmd/Ctrl+/", textKey: "editor.help.vscode.comment" },
      { keys: "Cmd/Ctrl+D", textKey: "editor.help.vscode.multiSelect" },
    ],
  },
};

export function EditorTab() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const { editor } = settings;
  const help = KEYMAP_HELP[editor.keymap];

  const keymapOptions: { value: EditorKeymap; label: string }[] = [
    { value: "default", label: t("editor.keymapOptions.default") },
    { value: "vim", label: t("editor.keymapOptions.vim") },
    { value: "vscode", label: t("editor.keymapOptions.vscode") },
  ];

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("editor.title")}</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">{t("editor.keymap.label")}</span>
          <div className="settings-description">{t("editor.keymap.description")}</div>
        </div>
        <Segmented
          value={editor.keymap}
          options={keymapOptions}
          onChange={(v) => updateSettings("editor.keymap", v)}
        />
      </div>

      <div className="settings-description settings-keymap-help">
        <strong>{t(help.titleKey)}</strong>
        <ul>
          {help.tips.map((tip) => (
            <li key={tip.textKey}>
              {tip.keys && (
                <Fragment>
                  <code>{tip.keys}</code>{" "}
                </Fragment>
              )}
              {t(tip.textKey)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
