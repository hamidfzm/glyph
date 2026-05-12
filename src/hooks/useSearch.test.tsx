import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
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
});
