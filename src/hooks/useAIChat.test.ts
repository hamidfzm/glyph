import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatOptions } from "@/lib/ai-providers";
import { createAIProvider } from "@/lib/ai-providers";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useAIChat } from "./useAIChat";

vi.mock("@/lib/ai-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-providers")>()),
  createAIProvider: vi.fn(),
}));

const mockCreate = vi.mocked(createAIProvider);

const ollamaSettings = { ...DEFAULT_SETTINGS.ai, provider: "ollama" as const };

function mockProvider(chat: (messages: ChatMessage[], options?: ChatOptions) => Promise<string>) {
  const spy = vi.fn(chat);
  mockCreate.mockReturnValue({ chat: spy });
  return spy;
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe("useAIChat", () => {
  it("streams the assistant reply into the transcript", async () => {
    mockProvider(async (_messages, options) => {
      options?.onChunk?.("Hel");
      options?.onChunk?.("lo");
      return "Hello";
    });

    const { result } = renderHook(() => useAIChat(ollamaSettings, () => null));

    await act(async () => {
      await result.current.send("hi there");
    });

    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns[0]).toMatchObject({ role: "user", content: "hi there" });
    expect(result.current.turns[1]).toMatchObject({ role: "assistant", content: "Hello" });
    expect(result.current.streaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sends prior turns as history and the document as system prompt", async () => {
    const chat = mockProvider(async (_messages, options) => {
      options?.onChunk?.("ok");
      return "ok";
    });

    const { result } = renderHook(() =>
      useAIChat(ollamaSettings, () => ({ content: "# My Doc", path: "doc.md" })),
    );

    await act(async () => {
      await result.current.send("first");
    });
    await act(async () => {
      await result.current.send("second");
    });

    const [messages, options] = chat.mock.calls[1];
    expect(messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
    ]);
    expect(options?.system).toContain("# My Doc");
    expect(options?.system).toContain("doc.md");
  });

  it("keeps the user's display label separate from the sent prompt", async () => {
    const chat = mockProvider(async () => "done");
    const { result } = renderHook(() => useAIChat(ollamaSettings, () => null));

    await act(async () => {
      await result.current.send("Summarize the following passage:\n\nlong text", "Summarize");
    });

    expect(result.current.turns[0].display).toBe("Summarize");
    expect(chat.mock.calls[0][0][0].content).toContain("long text");
  });

  it("surfaces provider errors and drops the empty assistant turn", async () => {
    mockProvider(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useAIChat(ollamaSettings, () => null));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toBe("boom");
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0].role).toBe("user");
    expect(result.current.streaming).toBe(false);
  });

  it("stringifies non-Error rejections", async () => {
    mockProvider(async () => {
      throw "socket hung up";
    });
    const { result } = renderHook(() => useAIChat(ollamaSettings, () => null));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toBe("socket hung up");
  });

  it("a new send supersedes the in-flight one without ending its streaming state", async () => {
    let firstReject: ((err: unknown) => void) | undefined;
    const chat = vi
      .fn()
      .mockImplementationOnce(
        (_messages: ChatMessage[], options?: ChatOptions) =>
          new Promise<string>((_resolve, reject) => {
            firstReject = reject;
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      )
      .mockResolvedValue("second reply");
    mockCreate.mockReturnValue({ chat });
    const { result } = renderHook(() => useAIChat(ollamaSettings, () => null));

    act(() => {
      void result.current.send("first");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    // The second send aborts the first; the first's cleanup must not clear the
    // streaming flag owned by the second.
    await act(async () => {
      await result.current.send("second");
    });

    expect(firstReject).toBeDefined();
    expect(result.current.streaming).toBe(false);
    const contents = result.current.turns.map((turn) => turn.content);
    expect(contents).toContain("second reply");
  });

  it("keeps the partial reply when the stream is aborted", async () => {
    mockProvider(async (_messages, options) => {
      options?.onChunk?.("partial");
      throw new DOMException("aborted", "AbortError");
    });
    const { result } = renderHook(() => useAIChat(ollamaSettings, () => null));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.turns[1]).toMatchObject({ role: "assistant", content: "partial" });
  });

  it("aborts the in-flight request on stop", async () => {
    let signal: AbortSignal | undefined;
    mockProvider(
      (_messages, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal;
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const { result } = renderHook(() => useAIChat(ollamaSettings, () => null));

    act(() => {
      void result.current.send("hi");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    act(() => {
      result.current.stop();
    });

    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.streaming).toBe(false));
  });

  it("reports a configuration error when no provider is available", async () => {
    mockCreate.mockReturnValue(null);
    const { result } = renderHook(() => useAIChat(DEFAULT_SETTINGS.ai, () => null));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toMatch(/provider/i);
    expect(result.current.turns).toHaveLength(0);
  });

  it("clear empties the transcript and error", async () => {
    mockProvider(async () => "reply");
    const { result } = renderHook(() => useAIChat(ollamaSettings, () => null));

    await act(async () => {
      await result.current.send("hi");
    });
    act(() => {
      result.current.clear();
    });

    expect(result.current.turns).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });
});
