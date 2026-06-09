import type { Extension } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import type { EditorKeymap } from "./settings";

export interface KeymapExtensions {
  /** Extensions that must precede the editor's other keymaps. Vim installs its
   *  modal handler here so it has the highest precedence. */
  leading: Extension[];
  /** Extra key bindings merged into the editor's main keymap (VSCode preset). */
  extraKeys: readonly KeyBinding[];
}

// Resolve a keymap preset into the CodeMirror pieces the editor needs to add.
// "default" adds nothing (Glyph's built-in bindings stay as-is).
export function editorKeymapExtensions(preset: EditorKeymap): KeymapExtensions {
  if (preset === "vim") return { leading: [vim()], extraKeys: [] };
  if (preset === "vscode") return { leading: [], extraKeys: vscodeKeymap };
  return { leading: [], extraKeys: [] };
}
