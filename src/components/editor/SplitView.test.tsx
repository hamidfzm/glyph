import { act, fireEvent, render } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { captureResizeObserver, sizeScroller, stubOffsetTop } from "@/test/scrollMetrics";

const LINE_HEIGHT = 20;

// The stand-ins reproduce the markup and the view handoff the sync hook needs,
// so these tests exercise the real wiring rather than the hook's own behaviour,
// which useSyncedScroll.test.ts covers against the same fake geometry.
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({
    content,
    onChange,
    onViewReady,
  }: {
    content: string;
    onChange: (v: string) => void;
    onViewReady?: (view: unknown) => void;
  }) => {
    const scrollerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const scrollDOM = scrollerRef.current;
      if (!scrollDOM || !onViewReady) return;
      const blockFor = (line: number) => ({
        from: line - 1,
        top: (line - 1) * LINE_HEIGHT,
        height: LINE_HEIGHT,
      });
      onViewReady({
        scrollDOM,
        get documentTop() {
          return -scrollDOM.scrollTop;
        },
        elementAtHeight: (h: number) => blockFor(Math.floor(h / LINE_HEIGHT) + 1),
        lineBlockAt: (pos: number) => blockFor(pos + 1),
        state: {
          doc: {
            lines: 100,
            lineAt: (pos: number) => ({ number: pos + 1 }),
            line: (line: number) => ({ from: line - 1 }),
          },
        },
      });
      return () => onViewReady(null);
    }, [onViewReady]);
    return (
      <div ref={scrollerRef} className="cm-scroller" data-testid="editor-scroller">
        <div className="cm-content">
          <textarea
            data-testid="editor"
            value={content}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    );
  },
}));

vi.mock("@/components/markdown/MarkdownViewer", () => ({
  MarkdownViewer: ({ content, sourceLines }: { content: string; sourceLines?: boolean }) => (
    <div data-scroll-container="" data-testid="preview" data-source-lines={String(sourceLines)}>
      <div className="markdown-body">
        <p data-line="1">{content}</p>
        <p data-line="11" data-testid="last-anchor" />
      </div>
    </div>
  ),
}));

import { SplitView } from "./SplitView";

function renderSplit(syncScroll: boolean) {
  const fireResize = captureResizeObserver();
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
  sizeScroller(preview, 1000);
  // The anchors were measured on mount, before these offsets existed, so a
  // reflow is fired to re-measure them the way a real image load would.
  stubOffsetTop(view.getByTestId("last-anchor"), 500);
  fireResize();
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

    // Line 6 of the anchored range 1..11, halfway between the two anchors.
    editor.scrollTop = 5 * LINE_HEIGHT;
    editor.dispatchEvent(new Event("scroll"));

    expect(preview.scrollTop).toBe(250);
  });

  it("leaves the panes independent when the setting is off", () => {
    const { editor, preview } = renderSplit(false);

    editor.scrollTop = 5 * LINE_HEIGHT;
    editor.dispatchEvent(new Event("scroll"));

    expect(preview.scrollTop).toBe(0);
  });

  // The markers only exist to anchor the sync, so they are not worth emitting
  // into every rendered document when the panes scroll independently.
  it("asks for source-line markers while the panes are linked", () => {
    expect(renderSplit(true).preview.dataset.sourceLines).toBe("true");
  });

  it("skips source-line markers when the panes are independent", () => {
    expect(renderSplit(false).preview.dataset.sourceLines).toBe("false");
  });
});
