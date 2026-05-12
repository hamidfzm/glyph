import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
    <textarea data-testid="editor" value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock("../markdown/MarkdownViewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div data-testid="preview">{content}</div>,
}));

import { SplitView } from "./SplitView";

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
});
