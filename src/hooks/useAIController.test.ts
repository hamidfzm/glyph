import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/ai-providers";
import { createAIProvider } from "@/lib/ai-providers";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useAIController } from "./useAIController";

vi.mock("@/lib/ai-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-providers")>()),
  createAIProvider: vi.fn(),
}));

const mockCreate = vi.mocked(createAIProvider);

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockReturnValue({ chat: vi.fn().mockResolvedValue("reply") });
});

describe("useAIController", () => {
  it("starts with panelOpen=false and configured derived from provider", () => {
    const { result } = renderHook(() => useAIController(DEFAULT_SETTINGS.ai, null));
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.configured).toBe(false);
    expect(
      renderHook(() => useAIController({ ...DEFAULT_SETTINGS.ai, provider: "ollama" }, null)).result
        .current.configured,
    ).toBe(true);
  });

  it("runAction opens the panel and sends the action as a chat turn", async () => {
    const chat = vi.fn().mockResolvedValue("reply");
    mockCreate.mockReturnValue({ chat });
    const { result } = renderHook(() =>
      useAIController({ ...DEFAULT_SETTINGS.ai, provider: "ollama" }, { content: "# Doc" }),
    );

    await act(async () => {
      result.current.runAction("summarize");
    });

    expect(result.current.panelOpen).toBe(true);
    const messages = chat.mock.calls[0][0] as ChatMessage[];
    expect(messages[0].content).toMatch(/summarize/i);
    // The transcript shows the short localized label, not the raw prompt.
    expect(result.current.chat.turns[0].display).toBe("Summarize the document");
  });

  it("runAction embeds the selection when one is passed", async () => {
    const chat = vi.fn().mockResolvedValue("reply");
    mockCreate.mockReturnValue({ chat });
    const { result } = renderHook(() =>
      useAIController({ ...DEFAULT_SETTINGS.ai, provider: "ollama" }, { content: "# Doc" }),
    );

    await act(async () => {
      result.current.runAction("explain", "selected passage");
    });

    const messages = chat.mock.calls[0][0] as ChatMessage[];
    expect(messages[0].content).toContain("selected passage");
    expect(result.current.chat.turns[0].display).toBe("Explain the selection");
  });

  it("togglePanel and closePanel drive the open state without clearing the chat", async () => {
    const { result } = renderHook(() =>
      useAIController({ ...DEFAULT_SETTINGS.ai, provider: "ollama" }, null),
    );

    await act(async () => {
      result.current.runAction("summarize");
    });
    act(() => {
      result.current.closePanel();
    });
    expect(result.current.panelOpen).toBe(false);
    // Conversation survives the close.
    expect(result.current.chat.turns.length).toBeGreaterThan(0);

    act(() => {
      result.current.togglePanel();
    });
    expect(result.current.panelOpen).toBe(true);
  });
});
