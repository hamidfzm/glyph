import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useAIController } from "./useAIController";

describe("useAIController", () => {
  it("starts with panelOpen=false and configured derived from provider", () => {
    const { result } = renderHook(() => useAIController(DEFAULT_SETTINGS.ai));
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.configured).toBe(DEFAULT_SETTINGS.ai.provider !== "none");
  });

  it("runAction opens the panel", () => {
    const { result } = renderHook(() =>
      useAIController({ ...DEFAULT_SETTINGS.ai, provider: "none" }),
    );
    act(() => {
      result.current.runAction("summarize", "hello world");
    });
    expect(result.current.panelOpen).toBe(true);
  });

  it("closePanel closes the panel and clears state", () => {
    const { result } = renderHook(() => useAIController(DEFAULT_SETTINGS.ai));
    act(() => {
      result.current.runAction("summarize", "x");
    });
    act(() => {
      result.current.closePanel();
    });
    expect(result.current.panelOpen).toBe(false);
  });
});
