import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { wrapSelectionWith } from "@/lib/editorWrapSelection";

export interface EditorMenuLabels {
  bold: string;
  italic: string;
  code: string;
  strikethrough: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
}

// Only one menu exists at a time, so a fresh right-click never leaks the
// previous menu's node or its document listeners.
let closeOpenMenu: (() => void) | null = null;

interface MenuEntry {
  label: string;
  enabled: boolean;
  run: () => void;
}

function openMenu(x: number, y: number, entries: (MenuEntry | "separator")[]): void {
  closeOpenMenu?.();

  const menu = document.createElement("div");
  menu.className = "cm-editor-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  function close(): void {
    menu.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    closeOpenMenu = null;
  }

  function onOutside(event: MouseEvent): void {
    if (!menu.contains(event.target as Node)) close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }

  for (const entry of entries) {
    if (entry === "separator") {
      const divider = document.createElement("div");
      divider.className = "cm-editor-menu-divider";
      menu.appendChild(divider);
      continue;
    }
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cm-editor-menu-item";
    item.textContent = entry.label;
    item.disabled = !entry.enabled;
    item.addEventListener("click", () => {
      entry.run();
      close();
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  // Keep the menu inside the viewport when opened near an edge.
  const box = menu.getBoundingClientRect();
  if (box.right > window.innerWidth) menu.style.left = `${window.innerWidth - box.width - 4}px`;
  if (box.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - box.height - 4}px`;

  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  closeOpenMenu = close;
}

/**
 * Themed right-click menu for the editor, replacing the WebView's native menu
 * (Back / Reload / Inspect), which offers nothing useful while writing. Adds
 * the inline formatting actions plus the clipboard entries the native menu was
 * the only source of.
 */
export function editorContextMenu(getLabels: () => EditorMenuLabels): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      // Spell check claims the event first when a misspelled word is hit, so
      // its suggestion menu still wins over this one.
      if (event.defaultPrevented) return false;
      event.preventDefault();

      const labels = getLabels();
      const hasSelection = !view.state.selection.main.empty;

      const wrap = (marker: string) => () => {
        const spec = wrapSelectionWith(view.state, marker);
        if (spec) view.dispatch(spec);
        view.focus();
      };

      openMenu(event.clientX, event.clientY, [
        { label: labels.bold, enabled: hasSelection, run: wrap("**") },
        { label: labels.italic, enabled: hasSelection, run: wrap("*") },
        { label: labels.code, enabled: hasSelection, run: wrap("`") },
        { label: labels.strikethrough, enabled: hasSelection, run: wrap("~~") },
        "separator",
        {
          label: labels.cut,
          enabled: hasSelection,
          run: () => {
            document.execCommand("cut");
            view.focus();
          },
        },
        {
          label: labels.copy,
          enabled: hasSelection,
          run: () => {
            document.execCommand("copy");
            view.focus();
          },
        },
        {
          label: labels.paste,
          enabled: true,
          run: () => {
            // execCommand("paste") is blocked in the WebView, so read the
            // clipboard directly and replace the selection ourselves.
            navigator.clipboard.readText().then((text) => {
              if (text) view.dispatch(view.state.replaceSelection(text));
              view.focus();
            });
          },
        },
        "separator",
        {
          label: labels.selectAll,
          enabled: true,
          run: () => {
            view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
            view.focus();
          },
        },
      ]);
      return true;
    },
  });
}
