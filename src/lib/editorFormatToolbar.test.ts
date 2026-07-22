import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { formatToolbar, formatToolbarPlacement } from "./editorFormatToolbar";

const LABELS = {
  bold: "Bold",
  italic: "Italic",
  code: "Inline code",
  strikethrough: "Strikethrough",
};

function mount(doc: string, selection: { anchor: number; head?: number }) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, selection, extensions: [formatToolbar(() => LABELS)] }),
    parent,
  });
  const toolbar = view.dom.querySelector<HTMLElement>(".cm-format-toolbar");
  const cleanup = () => {
    view.destroy();
    parent.remove();
  };
  return { view, toolbar, cleanup };
}

describe("formatToolbar", () => {
  it("stays hidden while nothing is selected", () => {
    const { toolbar, cleanup } = mount("foo bar", { anchor: 1 });
    expect(toolbar?.style.visibility).toBe("hidden");
    cleanup();
  });

  it("labels each action for screen readers", () => {
    const { toolbar, cleanup } = mount("foo bar", { anchor: 0, head: 3 });
    const labels = [...(toolbar?.querySelectorAll("button") ?? [])].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Bold", "Italic", "Inline code", "Strikethrough"]);
    cleanup();
  });

  it("wraps the selection when an action is pressed", () => {
    const { view, toolbar, cleanup } = mount("foo bar", { anchor: 0, head: 3 });
    const bold = toolbar?.querySelector<HTMLButtonElement>('[data-action="bold"]');
    bold?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("**foo** bar");
    cleanup();
  });

  it("hides again once the selection collapses", () => {
    const { view, toolbar, cleanup } = mount("foo bar", { anchor: 0, head: 3 });
    view.dispatch({ selection: { anchor: 2 } });
    expect(toolbar?.style.visibility).toBe("hidden");
    cleanup();
  });
});

describe("formatToolbarPlacement", () => {
  // Editor box 400 wide, starting at (0, 0) in viewport terms.
  const box = { top: 0, bottom: 300, left: 0, right: 400 };
  const line = (top: number, left: number, right: number) => ({
    top,
    bottom: top + 20,
    left,
    right,
  });

  it("sits above the selection, clear of the text", () => {
    const p = formatToolbarPlacement(line(100, 50, 150), line(100, 50, 150), box, 120, 30);
    // 100 - 0 - 30 - 6 = 64, so the toolbar bottom (64 + 30 = 94) clears the
    // selection top (100).
    expect(p.top).toBe(64);
    expect(p.top + 30).toBeLessThan(100);
  });

  it("drops below when the selection is too near the top", () => {
    const sel = line(10, 50, 150);
    const p = formatToolbarPlacement(sel, sel, box, 120, 30);
    // No room above, so it goes under the last line: bottom (30) + gap.
    expect(p.top).toBe(36);
    expect(p.top).toBeGreaterThan(sel.bottom - box.top);
  });

  it("centres over the selection", () => {
    const p = formatToolbarPlacement(line(100, 100, 200), line(100, 100, 200), box, 120, 30);
    expect(p.left).toBe(90); // centre 150 - half width 60
  });

  it("clamps to the left edge", () => {
    const p = formatToolbarPlacement(line(100, 0, 10), line(100, 0, 10), box, 120, 30);
    expect(p.left).toBe(4);
  });

  it("clamps to the right edge", () => {
    const p = formatToolbarPlacement(line(100, 390, 400), line(100, 390, 400), box, 120, 30);
    expect(p.left).toBe(276); // 400 - 120 - 4
  });

  it("spans multi-line selections from the first line's top", () => {
    const p = formatToolbarPlacement(line(100, 50, 300), line(160, 10, 80), box, 120, 30);
    expect(p.top).toBe(64);
  });
});

describe("formatToolbar placement in the editor", () => {
  // happy-dom has no layout, so stub the geometry the plugin reads.
  function mountWithLayout(selection: { anchor: number; head?: number }) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const plugin = formatToolbar(() => LABELS);
    const view = new EditorView({
      state: EditorState.create({ doc: "foo bar", selection, extensions: [plugin] }),
      parent,
    });
    const instance = view.plugin(plugin);
    const bar = instance?.dom as HTMLElement;
    Object.defineProperty(bar, "offsetWidth", { value: 120, configurable: true });
    Object.defineProperty(bar, "offsetHeight", { value: 30, configurable: true });
    view.coordsAtPos = () => ({ top: 100, bottom: 120, left: 50, right: 150 });
    view.dom.getBoundingClientRect = () =>
      ({ top: 0, bottom: 300, left: 0, right: 400 }) as DOMRect;
    const cleanup = () => {
      view.destroy();
      parent.remove();
    };
    return { view, instance, bar, cleanup };
  }

  it("positions and reveals the toolbar once geometry is available", () => {
    const { instance, bar, cleanup } = mountWithLayout({ anchor: 0, head: 3 });
    instance?.apply(instance.measure());
    expect(bar.style.visibility).toBe("visible");
    expect(bar.style.top).toBe("64px");
    expect(bar.style.left).toBe("40px");
    cleanup();
  });

  it("reports unplaceable while the height is still zero", () => {
    const { instance, bar, cleanup } = mountWithLayout({ anchor: 0, head: 3 });
    Object.defineProperty(bar, "offsetHeight", { value: 0, configurable: true });
    expect(instance?.measure()).toBeNull();
    cleanup();
  });

  it("reports unplaceable when the selection has no coordinates", () => {
    const { view, instance, cleanup } = mountWithLayout({ anchor: 0, head: 3 });
    view.coordsAtPos = () => null;
    expect(instance?.measure()).toBeNull();
    cleanup();
  });

  it("removes the toolbar from the DOM when destroyed", () => {
    const { view, bar, cleanup } = mountWithLayout({ anchor: 0, head: 3 });
    expect(view.dom.contains(bar)).toBe(true);
    view.destroy();
    expect(bar.isConnected).toBe(false);
    cleanup();
  });
});
