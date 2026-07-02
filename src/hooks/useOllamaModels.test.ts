import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOllamaModels } from "@/lib/ai-providers";
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

    // Probing while the debounced fetch is pending.
    expect(result.current).toEqual({ models: [], status: "loading" });

    await waitFor(() =>
      expect(result.current).toEqual({
        models: ["gemma2:latest", "llama3.2:8b"],
        status: "ok",
      }),
    );
    expect(mockFetchModels).toHaveBeenCalledWith("http://localhost:11434", expect.any(AbortSignal));
  });

  it("reports the error state when the server is unreachable", async () => {
    mockFetchModels.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useOllamaModels("http://localhost:11434", true));

    await waitFor(() => expect(result.current).toEqual({ models: [], status: "error" }));
  });

  it("refetches when the URL changes", async () => {
    mockFetchModels.mockResolvedValue(["a:latest"]);
    const { result, rerender } = renderHook(({ url }) => useOllamaModels(url, true), {
      initialProps: { url: "http://localhost:11434" },
    });
    await waitFor(() => expect(result.current.models).toEqual(["a:latest"]));

    mockFetchModels.mockResolvedValue(["b:latest"]);
    rerender({ url: "http://other:11434" });
    await waitFor(() => expect(result.current.models).toEqual(["b:latest"]));
    expect(mockFetchModels).toHaveBeenLastCalledWith("http://other:11434", expect.any(AbortSignal));
  });

  it("stays idle and does not fetch when disabled", async () => {
    const { result } = renderHook(() => useOllamaModels("http://localhost:11434", false));
    expect(result.current).toEqual({ models: [], status: "idle" });
    // Give the debounce window a chance to elapse.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mockFetchModels).not.toHaveBeenCalled();
  });

  it("does not flip to error when the fetch is aborted by unmount", async () => {
    let reject: ((err: unknown) => void) | undefined;
    mockFetchModels.mockImplementation(
      (_url, signal) =>
        new Promise<string[]>((_resolve, rej) => {
          reject = rej;
          signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        }),
    );
    const { result, unmount } = renderHook(() => useOllamaModels("http://localhost:11434", true));
    await waitFor(() => expect(mockFetchModels).toHaveBeenCalled());
    unmount();
    expect(reject).toBeDefined();
    // The aborted rejection must not surface as an error state update.
    expect(result.current.status).toBe("loading");
  });
});
