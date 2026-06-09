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
    </div>
  );
}
