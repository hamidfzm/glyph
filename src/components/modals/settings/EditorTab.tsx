import { Fragment } from "react";
import { useSettings } from "@/hooks/useSettings";
import type { EditorKeymap } from "@/lib/settings";
import { Segmented } from "./Segmented";

const KEYMAP_OPTIONS: { value: EditorKeymap; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "vim", label: "Vim" },
  { value: "vscode", label: "VSCode" },
];

interface KeymapTip {
  keys?: string;
  text: string;
}

// Short, per-preset cheat sheet shown under the selector. Modifier-bearing
// shortcuts are written generically ("Cmd/Ctrl") since the bindings are the same
// across platforms apart from the primary modifier.
const KEYMAP_HELP: Record<EditorKeymap, { title: string; tips: KeymapTip[] }> = {
  default: {
    title: "Default (Glyph) shortcuts",
    tips: [
      { keys: "[[", text: "in a folder workspace opens wikilink autocomplete" },
      { keys: "Tab / Enter", text: "accept the highlighted completion" },
      { keys: "Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z", text: "undo / redo" },
      { text: "Standard OS text-editing shortcuts otherwise" },
    ],
  },
  vim: {
    title: "Vim quick reference",
    tips: [
      { keys: "Esc / i / a / v", text: "normal, insert, insert-after, visual modes" },
      { keys: "w b e 0 $ gg G", text: "motions; f + char to jump; / to search" },
      { keys: "d c y p", text: 'operators with counts and text objects (diw, ci")' },
      {
        text: "File commands like :w, :q, and :wq don't apply here — Glyph autosaves, and you close a tab with the Close Tab shortcut.",
      },
    ],
  },
  vscode: {
    title: "VSCode shortcuts",
    tips: [
      { keys: "Alt+Up / Alt+Down", text: "move the current line up / down" },
      { keys: "Shift+Alt+Up / Down", text: "copy the line up / down" },
      { keys: "Cmd/Ctrl+/", text: "toggle line comment" },
      {
        keys: "Cmd/Ctrl+D",
        text: "select the next occurrence; Cmd/Ctrl+] or [ to indent / outdent",
      },
    ],
  },
};

export function EditorTab() {
  const { settings, updateSettings } = useSettings();
  const { editor } = settings;
  const help = KEYMAP_HELP[editor.keymap];

  return (
    <div className="settings-section">
      <div className="settings-section-title">Editor</div>
      <div className="settings-row">
        <div>
          <span className="settings-label">Keymap</span>
          <div className="settings-description">
            Keyboard bindings for the markdown editor. Vim adds modal editing; VSCode mirrors common
            VSCode shortcuts. Takes effect the next time a document enters edit or split mode.
          </div>
        </div>
        <Segmented
          value={editor.keymap}
          options={KEYMAP_OPTIONS}
          onChange={(v) => updateSettings("editor.keymap", v)}
        />
      </div>

      <div className="settings-description settings-keymap-help">
        <strong>{help.title}</strong>
        <ul>
          {help.tips.map((tip) => (
            <li key={tip.text}>
              {tip.keys && (
                <Fragment>
                  <code>{tip.keys}</code>{" "}
                </Fragment>
              )}
              {tip.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
