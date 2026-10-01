import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RehypeContribution } from "@/lib/markdown/lazyPlugins";
import type { LazyMarkdownPlugin, MarkdownPlugin } from "@/lib/plugins/types";
import { useLazyMarkdownPlugins } from "./useLazyMarkdownPlugins";

const plugin = (): MarkdownPlugin => () => () => {};

function deferredLazy() {
  let finish: (value: MarkdownPlugin) => void = () => {};
  const entry: LazyMarkdownPlugin = {
    detect: (markdown) => markdown.includes("math"),
    load: vi.fn(() => new Promise<MarkdownPlugin>((resolve) => (finish = resolve))),
  };
  return { entry, finish: (value: MarkdownPlugin) => finish(value) };
}

describe("useLazyMarkdownPlugins", () => {
  it("passes plain plugins through and loads nothing a document does not need", () => {
    const plain = plugin();
    const { entry } = deferredLazy();
    const { result } = renderHook(() => useLazyMarkdownPlugins([plain, entry], "prose"));
    expect(result.current).toEqual([plain]);
    expect(entry.load).not.toHaveBeenCalled();
  });

  it("re-renders with a lazy plugin once its load lands", async () => {
    const plain = plugin();
    const loaded = plugin();
    const { entry, finish } = deferredLazy();
    const entries: RehypeContribution[] = [plain, entry];
    const { result } = renderHook(() => useLazyMarkdownPlugins(entries, "some math"));
    expect(result.current).toEqual([plain]);

    await waitFor(() => expect(entry.load).toHaveBeenCalled());
    await act(async () => finish(loaded));
    await waitFor(() => expect(result.current).toEqual([plain, loaded]));
  });

  it("ignores a load that lands after its plugin was removed", async () => {
    const plain = plugin();
    const { entry, finish } = deferredLazy();
    const { result, rerender } = renderHook(
      ({ entries }) => useLazyMarkdownPlugins(entries, "math"),
      { initialProps: { entries: [plain, entry] as RehypeContribution[] } },
    );
    await waitFor(() => expect(entry.load).toHaveBeenCalled());

    const withoutEntry = [plain];
    rerender({ entries: withoutEntry });
    await act(async () => finish(plugin()));
    expect(result.current).toEqual([plain]);
  });
});
