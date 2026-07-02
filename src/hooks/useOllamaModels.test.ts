import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOllamaModels } from "@/lib/ai-providers";
import { MODEL_SUGGESTIONS } from "@/lib/settings";
import { useOllamaModels } from "./useOllamaModels";

vi.mock("@/lib/ai-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-providers")>()),
  fetchOllamaModels: vi.fn(),
}));

const mockFetchModels = vi.mocked(fetchOllamaModels);

beforeEach(() => {
  mockFetchModels.mockReset();
});

describe("useOllamaModels", () => {
  it("returns the installed models once the server responds", async () => {
    mockFetchModels.mockResolvedValue(["gemma2:latest", "llama3.2:8b"]);
    const { result } = renderHook(() => useOllamaModels("http://localhost:11434", true));

    // Fallback suggestions while the debounced fetch is pending.
    expect(result.current).toEqual(MODEL_SUGGESTIONS.ollama);

    await waitFor(() => expect(result.current).toEqual(["gemma2:latest", "llama3.2:8b"]));
    expect(mockFetchModels).toHaveBeenCalledWith("http://localhost:11434", expect.any(AbortSignal));
  });

  it("falls back to the built-in suggestions when the server is unreachable", async () => {
    mockFetchModels.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useOllamaModels("http://localhost:11434", true));

    await waitFor(() => expect(mockFetchModels).toHaveBeenCalled());
    expect(result.current).toEqual(MODEL_SUGGESTIONS.ollama);
  });

  it("refetches when the URL changes", async () => {
    mockFetchModels.mockResolvedValue(["a:latest"]);
    const { result, rerender } = renderHook(({ url }) => useOllamaModels(url, true), {
      initialProps: { url: "http://localhost:11434" },
    });
    await waitFor(() => expect(result.current).toEqual(["a:latest"]));

    mockFetchModels.mockResolvedValue(["b:latest"]);
    rerender({ url: "http://other:11434" });
    await waitFor(() => expect(result.current).toEqual(["b:latest"]));
    expect(mockFetchModels).toHaveBeenLastCalledWith("http://other:11434", expect.any(AbortSignal));
  });

  it("does not fetch when disabled", async () => {
    const { result } = renderHook(() => useOllamaModels("http://localhost:11434", false));
    expect(result.current).toEqual(MODEL_SUGGESTIONS.ollama);
    // Give the debounce window a chance to elapse.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mockFetchModels).not.toHaveBeenCalled();
  });
});
