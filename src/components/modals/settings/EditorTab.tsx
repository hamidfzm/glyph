import { useSettings } from "@/hooks/useSettings";
import type { EditorKeymap } from "@/lib/settings";
import { Segmented } from "./Segmented";

const KEYMAP_OPTIONS: { value: EditorKeymap; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "vim", label: "Vim" },
  { value: "vscode", label: "VSCode" },
];

export function EditorTab() {
  const { settings, updateSettings } = useSettings();
  const { editor } = settings;

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

      {editor.keymap === "vim" && (
        <div className="settings-description settings-vim-help">
          <strong>Vim quick reference</strong>
          <ul>
            <li>
              Modes: <code>Esc</code> normal, <code>i</code>/<code>a</code> insert, <code>v</code>{" "}
              visual
            </li>
            <li>
              Motions: <code>w b e 0 $ gg G</code>, <code>f</code> + char to jump, <code>/</code> to
              search
            </li>
            <li>
              Operators: <code>d c y p</code> with counts and text objects (e.g. <code>diw</code>,{" "}
              <code>ci"</code>)
            </li>
            <li>
              File commands like <code>:w</code>, <code>:q</code>, and <code>:wq</code> don't apply
              here — Glyph autosaves, and you close a tab with the Close Tab shortcut.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
