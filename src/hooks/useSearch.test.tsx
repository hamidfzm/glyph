import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { type RefObject, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearch } from "./useSearch";

function makeContainer(html: string): RefObject<HTMLDivElement | null> {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return { current: div };
}

function setup(html: string) {
  const ref = makeContainer(html);
  const { result } = renderHook(() => useSearch({ containerRef: ref }));
  return { ref, result };
}

function Harness({ text }: { text: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const search = useSearch({ containerRef: contentRef });
  return (
    <>
      <input
        aria-label="Find"
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
      />
      <button type="button" onClick={search.nextMatch}>
        Next
      </button>
      <button type="button" onClick={search.clear}>
        Clear
      </button>
      <output>{`${search.currentMatch} of ${search.matchCount}`}</output>
      <div ref={contentRef} data-testid="content">
        <p>{text}</p>
      </div>
    </>
  );
}

function searchFor(query: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: query } });
  act(() => {
    vi.advanceTimersByTime(150);
  });
}

// The DOM observer reports in a microtask, then the re-highlight waits a frame.
async function nextFrame() {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersToNextFrame();
  });
}

function activeMarkIndex(container: ParentNode) {
  const marks = [...container.querySelectorAll("mark.search-highlight")];
  return marks.findIndex((mark) => mark.classList.contains("search-highlight-active"));
}

interface ParagraphProps {
  lead?: boolean;
  text?: string;
}

type SearchRef = { current: ReturnType<typeof useSearch> | null };

// The <code> sibling gives the text a fiber of its own, the node React removes and inserts beside.
function SearchableParagraph({ lead, text, searchRef }: ParagraphProps & { searchRef: SearchRef }) {
  const contentRef = useRef<HTMLDivElement>(null);
  searchRef.current = useSearch({ containerRef: contentRef });
  return (
    <div ref={contentRef}>
      <p>
        {lead && <em>new </em>}
        {text}
        <code>x</code>
      </p>
    </div>
  );
}

function renderDocument(props: ParagraphProps) {
  const search: SearchRef = { current: null };
  const view = render(<SearchableParagraph {...props} searchRef={search} />);
  const highlight = (query: string) => {
    act(() => search.current?.setQuery(query));
    act(() => {
      vi.advanceTimersByTime(150);
    });
  };
  const rerender = async (next: ParagraphProps) => {
    view.rerender(<SearchableParagraph {...next} searchRef={search} />);
    await nextFrame();
  };
  const paragraph = () => view.container.querySelector("p");
  const marks = () => view.container.querySelectorAll("mark.search-highlight");
  return { search, highlight, rerender, paragraph, marks };
}

describe("useSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("starts empty", () => {
    const ref = { current: null as HTMLDivElement | null };
    const { result } = renderHook(() => useSearch({ containerRef: ref }));
    expect(result.current.query).toBe("");
    expect(result.current.matchCount).toBe(0);
    expect(result.current.currentMatch).toBe(0);
  });

  it("highlights matches and reports the count after the debounce", () => {
    const { ref, result } = setup("<p>hello world hello again</p>");
    act(() => {
      result.current.setQuery("hello");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.matchCount).toBe(2);
    expect(result.current.currentMatch).toBe(1);
    expect(ref.current?.querySelectorAll("mark.search-highlight").length).toBe(2);
  });

  it("matches case-insensitively", () => {
    const { result } = setup("<p>Foo foo FOO</p>");
    act(() => {
      result.current.setQuery("foo");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.matchCount).toBe(3);
  });

  it("skips script and style nodes", () => {
    const { result } = setup("<p>visible</p><script>visible bad</script><style>.visible{}</style>");
    act(() => {
      result.current.setQuery("visible");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.matchCount).toBe(1);
  });

  it("reports zero matches when nothing is found", () => {
    const { result } = setup("<p>nothing here</p>");
    act(() => {
      result.current.setQuery("xyz");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.matchCount).toBe(0);
    expect(result.current.currentMatch).toBe(0);
  });

  it("cycles forward with nextMatch and wraps to 1 after the last", () => {
    const { result } = setup("<p>a a a</p>");
    act(() => {
      result.current.setQuery("a");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.currentMatch).toBe(1);

    act(() => result.current.nextMatch());
    expect(result.current.currentMatch).toBe(2);
    act(() => result.current.nextMatch());
    expect(result.current.currentMatch).toBe(3);
    act(() => result.current.nextMatch());
    expect(result.current.currentMatch).toBe(1);
  });

  it("cycles backward with prevMatch and wraps to last from 1", () => {
    const { result } = setup("<p>a a a</p>");
    act(() => {
      result.current.setQuery("a");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => result.current.prevMatch());
    expect(result.current.currentMatch).toBe(3);
    act(() => result.current.prevMatch());
    expect(result.current.currentMatch).toBe(2);
  });

  it("keeps the match Next and Previous moved to past the next frame", async () => {
    const { ref, result } = setup("<p>a a a</p>");
    act(() => {
      result.current.setQuery("a");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    act(() => result.current.nextMatch());
    await nextFrame();
    expect(result.current.currentMatch).toBe(2);
    expect(activeMarkIndex(ref.current as HTMLDivElement)).toBe(1);

    act(() => result.current.prevMatch());
    act(() => result.current.prevMatch());
    await nextFrame();
    expect(result.current.currentMatch).toBe(3);
    expect(activeMarkIndex(ref.current as HTMLDivElement)).toBe(2);
  });

  it("schedules no re-highlight for its own highlighting", async () => {
    render(<Harness text="a a" />);
    searchFor("a");
    await nextFrame();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-highlights a re-rendered document in place, keeping the active match", async () => {
    const { rerender } = render(<Harness text="one two one" />);
    searchFor("one");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    rerender(<Harness text="one three one" />);
    await nextFrame();

    const content = screen.getByTestId("content");
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    expect(content.querySelectorAll("mark.search-highlight")).toHaveLength(2);
    expect(activeMarkIndex(content)).toBe(1);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("recounts after a re-render, holding the active match within the new count", async () => {
    const { rerender } = render(<Harness text="x x x" />);
    searchFor("x");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("status")).toHaveTextContent("3 of 3");
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    rerender(<Harness text="x x" />);
    await nextFrame();
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    expect(activeMarkIndex(screen.getByTestId("content"))).toBe(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce();

    rerender(<Harness text="nothing" />);
    await nextFrame();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 0");

    rerender(<Harness text="x again" />);
    await nextFrame();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 1");
  });

  it("starts a new query from the first match and scrolls to it", () => {
    render(<Harness text="ab ab ab" />);
    searchFor("ab");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 of 3");
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    searchFor("b");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("drops a re-highlight that was waiting for its frame when cleared", async () => {
    const { rerender } = render(<Harness text="word" />);
    searchFor("word");

    rerender(<Harness text="word word" />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await nextFrame();

    rerender(<Harness text="word word word" />);
    await nextFrame();

    expect(screen.getByRole("status")).toHaveTextContent("0 of 0");
    expect(screen.getByTestId("content").querySelectorAll("mark")).toHaveLength(0);
  });

  it("next/prev are no-ops when there are no matches", () => {
    const { result } = setup("<p>nothing</p>");
    act(() => result.current.nextMatch());
    act(() => result.current.prevMatch());
    expect(result.current.currentMatch).toBe(0);
  });

  it("clear() removes highlights and resets state", () => {
    const { ref, result } = setup("<p>aaa bbb</p>");
    act(() => {
      result.current.setQuery("aaa");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(ref.current?.querySelectorAll("mark.search-highlight").length).toBe(1);

    act(() => result.current.clear());
    expect(result.current.query).toBe("");
    expect(result.current.matchCount).toBe(0);
    expect(result.current.currentMatch).toBe(0);
    expect(ref.current?.querySelectorAll("mark.search-highlight").length).toBe(0);
  });

  it("does nothing when containerRef is null", () => {
    const ref = { current: null as HTMLDivElement | null };
    const { result } = renderHook(() => useSearch({ containerRef: ref }));
    act(() => {
      result.current.setQuery("anything");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.matchCount).toBe(0);
  });

  it("leaves the text of a diagram a plugin draws untouched", () => {
    const { ref, result } = setup(
      '<p>label</p><div data-fenced-language="excalidraw"><svg><text>label</text></svg></div>',
    );

    act(() => {
      result.current.setQuery("label");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.matchCount).toBe(1);
    expect(ref.current?.querySelector("svg text")?.innerHTML).toBe("label");
  });

  it("does not count the print-only media name, which nobody can scroll to", () => {
    const { result } = setup('<p>clip</p><span class="markdown-media-print">clip.mp4</span>');

    act(() => {
      result.current.setQuery("clip");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.matchCount).toBe(1);
  });

  describe("in a document React keeps rendering", () => {
    it("lets React remove a highlighted text node", async () => {
      const doc = renderDocument({ text: "alpha beta" });
      doc.highlight("beta");
      expect(doc.marks()).toHaveLength(1);

      await doc.rerender({});

      expect(doc.paragraph()).toHaveTextContent(/^x$/);
      expect(doc.marks()).toHaveLength(0);
      expect(doc.search.current?.matchCount).toBe(0);
    });

    it("lets React insert before a highlighted text node", async () => {
      const doc = renderDocument({ text: "alpha beta" });
      doc.highlight("beta");

      await doc.rerender({ lead: true, text: "alpha beta" });

      expect(doc.paragraph()).toHaveTextContent(/^new alpha betax$/);
      expect(doc.marks()).toHaveLength(1);
      expect(doc.search.current?.matchCount).toBe(1);
    });

    it("lets React remove a text node the search highlighted before it was closed", async () => {
      const doc = renderDocument({ text: "alpha beta" });
      doc.highlight("beta");
      act(() => doc.search.current?.clear());
      expect(doc.paragraph()).toHaveTextContent(/^alpha betax$/);

      await doc.rerender({});

      expect(doc.paragraph()).toHaveTextContent(/^x$/);
    });

    it("keeps the text React wrote over a highlighted node", async () => {
      const doc = renderDocument({ text: "alpha beta" });
      doc.highlight("beta");

      await doc.rerender({ text: "alpha gamma" });

      expect(doc.paragraph()).toHaveTextContent(/^alpha gammax$/);
      expect(doc.search.current?.matchCount).toBe(0);
    });

    it("replaces the previous query's highlights when the query changes", () => {
      const doc = renderDocument({ text: "alpha beta" });
      doc.highlight("beta");
      doc.highlight("alp");

      expect(doc.marks()).toHaveLength(1);
      expect(doc.marks()[0]).toHaveTextContent("alp");
      expect(doc.paragraph()).toHaveTextContent(/^alpha betax$/);
    });

    it("restores the text when the query is emptied", async () => {
      const doc = renderDocument({ text: "alpha beta" });
      doc.highlight("beta");
      doc.highlight("");

      expect(doc.marks()).toHaveLength(0);
      expect(doc.search.current?.matchCount).toBe(0);
      expect(doc.paragraph()).toHaveTextContent(/^alpha betax$/);

      await doc.rerender({});

      expect(doc.paragraph()).toHaveTextContent(/^x$/);
    });

    it("highlights a match at the start of a text node and restores it on clear", () => {
      const doc = renderDocument({ text: "alpha beta" });
      doc.highlight("alpha");
      expect(doc.marks()).toHaveLength(1);
      expect(doc.paragraph()).toHaveTextContent(/^alpha betax$/);

      act(() => doc.search.current?.clear());

      expect(doc.marks()).toHaveLength(0);
      expect(doc.paragraph()).toHaveTextContent(/^alpha betax$/);
    });
  });
});
