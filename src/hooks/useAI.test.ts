import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as providers from "../lib/ai-providers";
import type { AISettings } from "../lib/settings";
import { useAI } from "./useAI";

function settings(): AISettings {
  return {
    provider: "anthropic",
    apiKey: "k",
    model: "claude",
  } as unknown as AISettings;
}

describe("useAI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts idle", () => {
    const { result } = renderHook(() => useAI(settings()));
    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.action).toBeNull();
  });

  it("errors when no provider is configured", async () => {
    vi.spyOn(providers, "createAIProvider").mockReturnValue(null);
    const { result } = renderHook(() => useAI(settings()));

    await act(async () => {
      await result.current.run("summarize", "hello");
    });

    expect(result.current.error).toMatch(/No AI provider configured/);
    expect(result.current.action).toBe("summarize");
  });

  it("returns the provider's completion result", async () => {
    vi.spyOn(providers, "createAIProvider").mockReturnValue({
      complete: vi.fn().mockResolvedValue("OK"),
    } as never);

    const { result } = renderHook(() => useAI(settings()));
    await act(async () => {
      await result.current.run("explain", "hello");
    });

    expect(result.current.result).toBe("OK");
    expect(result.current.error).toBeNull();
    expect(result.current.action).toBe("explain");
  });

  it("captures provider errors as the error message", async () => {
    vi.spyOn(providers, "createAIProvider").mockReturnValue({
      complete: vi.fn().mockRejectedValue(new Error("rate-limited")),
    } as never);

    const { result } = renderHook(() => useAI(settings()));
    await act(async () => {
      await result.current.run("translate", "hello");
    });

    expect(result.current.error).toBe("rate-limited");
  });

  it("swallows AbortError without writing state", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.spyOn(providers, "createAIProvider").mockReturnValue({
      complete: vi.fn().mockRejectedValue(abort),
    } as never);

    const { result } = renderHook(() => useAI(settings()));
    await act(async () => {
      await result.current.run("simplify", "hello");
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("clear() resets state", async () => {
    vi.spyOn(providers, "createAIProvider").mockReturnValue({
      complete: vi.fn().mockResolvedValue("done"),
    } as never);

    const { result } = renderHook(() => useAI(settings()));
    await act(async () => {
      await result.current.run("summarize", "x");
    });
    await waitFor(() => expect(result.current.result).toBe("done"));

    act(() => {
      result.current.clear();
    });
    expect(result.current.result).toBeNull();
    expect(result.current.action).toBeNull();
  });
});
