import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGemojiPlugin } from "./useGemojiPlugin";

describe("useGemojiPlugin", () => {
  it("returns null for content without shortcodes and never loads", () => {
    const { result } = renderHook(() => useGemojiPlugin("plain text"));
    expect(result.current).toBeNull();
  });

  it("resolves the plugin once content contains a shortcode", async () => {
    const { result } = renderHook(({ content }) => useGemojiPlugin(content), {
      initialProps: { content: "hello :smile:" },
    });
    await waitFor(() => {
      expect(typeof result.current).toBe("function");
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
});
