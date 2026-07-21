import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { wrapSelectionWith } from "@/lib/editorWrapSelection";

export interface FormatToolbarLabels {
  bold: string;
  italic: string;
  code: string;
  strikethrough: string;
}

// Button glyph -> the marker it wraps with, and which label names it.
const ACTIONS = [
  { key: "bold", glyph: "B", marker: "**" },
  { key: "italic", glyph: "I", marker: "*" },
  { key: "code", glyph: "</>", marker: "`" },
  { key: "strikethrough", glyph: "S", marker: "~~" },
] as const;

interface Placement {
  left: number;
  top: number;
}

// A small toolbar that follows a non-empty selection, so styling is reachable
// with the mouse alone. Plain DOM inside the editor's own layer, positioned
// from selection coordinates.
export function formatToolbar(getLabels: () => FormatToolbarLabels): Extension {
  return ViewPlugin.fromClass(
    class {
      readonly dom: HTMLDivElement;
      retries = 0;

      constructor(readonly view: EditorView) {
        this.dom = document.createElement("div");
        this.dom.className = "cm-format-toolbar";
        // Hidden via inline visibility, not the `hidden` attribute: `hidden`
        // sets display:none (Tailwind's preflight enforces it), which zeroes the
        // measured height and drops the toolbar onto the text. visibility:hidden
        // keeps the box measurable.
        this.setVisible(false);
        const labels = getLabels();
        for (const action of ACTIONS) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "cm-format-toolbar-button";
          button.dataset.action = action.key;
          button.textContent = action.glyph;
          button.title = labels[action.key];
          button.setAttribute("aria-label", labels[action.key]);
          // mousedown, not click: the editor must not lose its selection to the
          // button before the wrap runs.
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
            const spec = wrapSelectionWith(view.state, action.marker);
            if (spec) view.dispatch(spec);
            view.focus();
          });
          this.dom.appendChild(button);
        }
        view.dom.appendChild(this.dom);
        this.schedule();
      }

      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged || update.geometryChanged) {
          this.retries = 0;
          this.schedule();
        }
      }

      // Layout may not be read during an update, so measuring and writing are
      // deferred to CodeMirror's measure cycle.
      schedule() {
        this.view.requestMeasure({
          read: () => this.measure(),
          write: (placement) => this.apply(placement),
        });
      }

      measure(): Placement | null {
        const { from, to, empty } = this.view.state.selection.main;
        if (empty) return null;
        const start = this.view.coordsAtPos(from);
        const end = this.view.coordsAtPos(to);
        if (!start || !end) return null;

        const width = this.dom.offsetWidth;
        const height = this.dom.offsetHeight;
        // A zero height means layout hasn't settled; placing now would drop the
        // toolbar on the text. Report unplaceable so apply() retries.
        if (height === 0 || width === 0) return null;

        const box = this.view.dom.getBoundingClientRect();
        // Center over the selection, clamped inside the editor.
        const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
        // Sit above the selection, or below it when the first line leaves no
        // room, so the toolbar is never clipped outside the editor.
        const above = start.top - box.top - height - 6;
        return {
          left: Math.max(4, Math.min(centre - box.left - width / 2, box.width - width - 4)),
          top: above >= 4 ? above : end.bottom - box.top + 6,
        };
      }

      apply(placement: Placement | null) {
        if (!placement) {
          this.setVisible(false);
          // Right after mount the editor's geometry can still be settling, so a
          // live selection may measure as unplaceable. Retry a couple of frames
          // rather than leave the toolbar invisible until the next edit.
          if (!this.view.state.selection.main.empty && this.retries < 3) {
            this.retries++;
            requestAnimationFrame(() => this.schedule());
          }
          return;
        }
        this.dom.style.left = `${placement.left}px`;
        this.dom.style.top = `${placement.top}px`;
        this.setVisible(true);
      }

      setVisible(visible: boolean) {
        this.dom.style.visibility = visible ? "visible" : "hidden";
        this.dom.style.pointerEvents = visible ? "auto" : "none";
      }

      destroy() {
        this.dom.remove();
      }
    },
  );
}
