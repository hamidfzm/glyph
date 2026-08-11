import { act, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { sizeScroller } from "@/test/scrollMetrics";

// The stand-ins reproduce the scroller markup the sync hook looks for, so the
// wiring tests below exercise the same selectors the real panes expose.
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
    <div className="cm-scroller" data-testid="editor-scroller">
      <div className="cm-content">
        <textarea data-testid="editor" value={content} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  ),
}));

vi.mock("@/components/markdown/MarkdownViewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => (
    <div data-scroll-container="" data-testid="preview">
      <div className="markdown-body">{content}</div>
    </div>
  ),
}));

import { SplitView } from "./SplitView";

function renderSplit(syncScroll: boolean) {
  const value: SettingsContextValue = {
    settings: { ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, syncScroll } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  const view = render(
    <SplitView content="hello" onChange={() => {}} searchOpen={false} onSearchClose={() => {}} />,
    { wrapper },
  );
  const editor = view.getByTestId("editor-scroller");
  const preview = view.getByTestId("preview");
  sizeScroller(editor, 1000);
  sizeScroller(preview, 400);
  return { editor, preview };
}

describe("SplitView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders editor and preview panels with the initial content", () => {
    const { getByTestId } = render(
      <SplitView content="hello" onChange={() => {}} searchOpen={false} onSearchClose={() => {}} />,
    );
    expect((getByTestId("editor") as HTMLTextAreaElement).value).toBe("hello");
    expect(getByTestId("preview").textContent).toBe("hello");
  });

  it("calls onChange immediately and debounces the preview by 300ms", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <SplitView content="v0" onChange={onChange} searchOpen={false} onSearchClose={() => {}} />,
    );

    act(() => {
      fireEvent.change(getByTestId("editor"), { target: { value: "v1" } });
    });

    expect(onChange).toHaveBeenCalledWith("v1");
    expect(getByTestId("preview").textContent).toBe("v0");

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(getByTestId("preview").textContent).toBe("v1");
  });

  // Regression: the preview pane must be a flex column with `min-h-0` so the
  // inner MarkdownViewer (which sizes itself with `flex-1` and positions its
  // scrollable region absolutely) actually has a height. A plain block
  // parent collapses to 0px and the preview appears empty.
  it("renders the preview pane as a flex column so MarkdownViewer can stretch", () => {
    const { getByTestId } = render(
      <SplitView content="hello" onChange={() => {}} searchOpen={false} onSearchClose={() => {}} />,
    );
    const preview = getByTestId("split-view-preview");
    expect(preview.className).toMatch(/\bflex\b/);
    expect(preview.className).toMatch(/\bflex-col\b/);
    expect(preview.className).toMatch(/\bmin-h-0\b/);
  });

  it("syncs the preview from the content prop when it changes from outside", () => {
    const { getByTestId, rerender } = render(
      <SplitView
        content="initial"
        onChange={() => {}}
        searchOpen={false}
        onSearchClose={() => {}}
      />,
    );
    rerender(
      <SplitView
        content="reloaded"
        onChange={() => {}}
        searchOpen={false}
        onSearchClose={() => {}}
      />,
    );
    expect(getByTestId("preview").textContent).toBe("reloaded");
  });

  it("links the panes when the setting is on", () => {
    const { editor, preview } = renderSplit(true);

    editor.scrollTop = 500;
    editor.dispatchEvent(new Event("scroll"));

    expect(preview.scrollTop).toBe(200);
  });

  it("leaves the panes independent when the setting is off", () => {
    const { editor, preview } = renderSplit(false);

    editor.scrollTop = 500;
    editor.dispatchEvent(new Event("scroll"));

    expect(preview.scrollTop).toBe(0);
  });
});
