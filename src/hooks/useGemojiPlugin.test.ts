import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGemojiPlugin } from "./useGemojiPlugin";

// Only the loader is stubbed; the shortcode detector stays real. Holding the
// chunk in flight is what lets a test land a load after the content moved on.
const { loadGemojiMock } = vi.hoisted(() => ({ loadGemojiMock: vi.fn() }));
vi.mock("@/components/markdown/lazyGemoji", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/markdown/lazyGemoji")>()),
  loadGemoji: () => loadGemojiMock(),
}));

const gemojiPlugin = () => {};

/** Hold the next load open; the returned function lets it finish. */
function deferLoad(): () => void {
  let settle = () => {};
  loadGemojiMock.mockReturnValue(
    new Promise((resolve) => {
      settle = () => resolve(gemojiPlugin);
    }),
  );
  return settle;
}

beforeEach(() => {
  loadGemojiMock.mockReset();
  loadGemojiMock.mockResolvedValue(gemojiPlugin);
});

describe("useGemojiPlugin", () => {
  it("returns null for content without shortcodes and never loads", () => {
    const { result } = renderHook(() => useGemojiPlugin("plain text"));
    expect(result.current).toBeNull();
    expect(loadGemojiMock).not.toHaveBeenCalled();
  });

  it("resolves the plugin once content contains a shortcode", async () => {
    const { result } = renderHook(({ content }) => useGemojiPlugin(content), {
      initialProps: { content: "hello :smile:" },
    });
    await waitFor(() => {
      expect(result.current).toBe(gemojiPlugin);
    });
  });

  it("goes back to null when the shortcode disappears", async () => {
    const { result, rerender } = renderHook(({ content }) => useGemojiPlugin(content), {
      initialProps: { content: "hello :smile:" },
    });
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    rerender({ content: "plain" });
    expect(result.current).toBeNull();
  });

  it("drops a load that lands after the content stopped needing it", async () => {
    const settle = deferLoad();
    const { result, rerender } = renderHook(({ content }) => useGemojiPlugin(content), {
      initialProps: { content: "hello :smile:" },
    });

    // The chunk is still in flight when the document loses its shortcodes.
    rerender({ content: "plain prose" });
    await act(async () => {
      settle();
    });
    expect(result.current).toBeNull();

    // The dropped load left nothing broken: a later shortcode still resolves.
    rerender({ content: "back :tada:" });
    await waitFor(() => {
      expect(result.current).toBe(gemojiPlugin);
    });
  });
});
