import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assistantTools, runAssistantTool } from "@/lib/ai/assistantTools";
import { MAX_TOOL_CALLS } from "@/lib/ai/toolLoop";
import {
  type ChatReply,
  type ToolCall,
  type ToolResult,
  ToolsUnsupportedError,
} from "@/lib/ai/types";
import { createAIProvider } from "@/lib/ai-providers";
import { type AISettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { READ_NOTE_TOOL } from "@/test/fixtures/toolTurns";
import { useAIChat } from "./useAIChat";

vi.mock("@/lib/ai-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-providers")>()),
  createAIProvider: vi.fn(),
}));
vi.mock("@/lib/ai/assistantTools", () => ({ assistantTools: vi.fn(), runAssistantTool: vi.fn() }));

const mockCreate = vi.mocked(createAIProvider);
const mockTools = vi.mocked(assistantTools);
const mockRun = vi.mocked(runAssistantTool);

// Each case names its own model: a model that refused tools stays refused
// for the rest of the session.
const settings = (model: string, ollama = true): AISettings => ({
  ...DEFAULT_SETTINGS.ai,
  provider: "ollama",
  model,
  assistantTools: { claude: false, openai: false, ollama },
});
const doc = {
  content: "# Index\n\n![a](https://img.test/a.png)",
  path: "/ws/Index.md",
  workspaceRoot: "/ws",
  workspaceFiles: ["/ws/Index.md", "/ws/Cooking.md"],
};
const asked: ToolCall = { id: "c1", name: "read_note", input: { ref: "Cooking" } };
const answer = (text: string): ChatReply => ({ text, toolCalls: [] });
const resultOf = (call: ToolCall, content = '{"content":"Recipes"}'): ToolResult => ({
  callId: call.id,
  name: call.name,
  content,
  isError: false,
});

function provider(...replies: Array<ChatReply | Error>) {
  const chat = vi.fn();
  for (const reply of replies) {
    if (reply instanceof Error) chat.mockRejectedValueOnce(reply);
    else chat.mockResolvedValueOnce(reply);
  }
  chat.mockResolvedValue(answer("ok"));
  mockCreate.mockReturnValue({ chat });
  return chat;
}

beforeEach(() => {
  mockCreate.mockReset();
  mockTools.mockReset().mockResolvedValue([READ_NOTE_TOOL]);
  mockRun.mockReset().mockImplementation(async (call) => resultOf(call));
});

describe("useAIChat with the vault tools", () => {
  it("reads notes through the tools, shows each call, and replays them on a follow-up", async () => {
    const chat = provider({ text: "", toolCalls: [asked] }, answer("It is about recipes."));
    const { result } = renderHook(() => useAIChat(settings("reads"), () => doc));

    await act(async () => {
      await result.current.send("What does Cooking say?");
    });

    const [, options] = chat.mock.calls[0];
    expect(options.tools).toEqual([READ_NOTE_TOOL]);
    expect(options.system).not.toContain("/ws/Cooking.md");
    expect(mockRun).toHaveBeenCalledWith(asked, "/ws/Index.md");
    expect(result.current.turns[1]).toMatchObject({
      content: "It is about recipes.",
      toolCalls: [{ key: 0, call: asked, status: "done", result: '{"content":"Recipes"}' }],
    });

    await act(async () => {
      await result.current.send("And Travel?");
    });
    expect(chat.mock.calls[2][0]).toEqual([
      { role: "user", content: "What does Cooking say?" },
      { role: "assistant", content: "", toolCalls: [asked] },
      { role: "tool", results: [resultOf(asked)] },
      { role: "assistant", content: "It is about recipes." },
      { role: "user", content: "And Travel?" },
    ]);
  });

  it("answers from today's prompt for an Ollama model that takes no tools, and remembers it", async () => {
    const chat = provider(new ToolsUnsupportedError("gemma does not support tools"));
    const { result } = renderHook(() => useAIChat(settings("no-tools"), () => doc));

    await act(async () => {
      await result.current.send("hi");
    });
    await act(async () => {
      await result.current.send("again");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.turns[1].content).toBe("ok");
    const [, retry] = chat.mock.calls[1];
    expect(retry.tools).toEqual([]);
    expect(retry.system).toContain("/ws/Cooking.md");
    // The next question goes without tools straight away.
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls[2][1].tools).toEqual([]);
  });

  it("offers no tools when the switch is off, and sends earlier replies as text alone", async () => {
    const chat = provider({ text: "", toolCalls: [asked] }, answer("It is about recipes."));
    const { result, rerender } = renderHook(({ ai }) => useAIChat(ai, () => doc), {
      initialProps: { ai: settings("switched") },
    });
    await act(async () => {
      await result.current.send("What does Cooking say?");
    });

    rerender({ ai: settings("switched", false) });
    await act(async () => {
      await result.current.send("And Travel?");
    });

    expect(mockTools).toHaveBeenCalledTimes(1);
    const [history, options] = chat.mock.calls[2];
    expect(options.tools).toEqual([]);
    expect(history).toEqual([
      { role: "user", content: "What does Cooking say?" },
      { role: "assistant", content: "It is about recipes." },
      { role: "user", content: "And Travel?" },
    ]);
  });

  it("lets no image a tool result names join the URLs the reply may load", async () => {
    const leak = "https://evil.test/leak.png";
    mockRun.mockImplementation(async (call) => resultOf(call, `{"content":"![x](${leak})"}`));
    provider({ text: "", toolCalls: [asked] }, answer(`![x](${leak})`));
    const { result } = renderHook(() => useAIChat(settings("images"), () => doc));

    await act(async () => {
      await result.current.send("Show the picture in Cooking");
    });

    expect(result.current.turns[1].quotedImageUrls).toEqual(["https://img.test/a.png"]);
  });

  it("drops the result of a call still running when Stop lands, and asks nothing more", async () => {
    let finish: (result: ToolResult) => void = () => {};
    mockRun.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const chat = provider({ text: "Looking.", toolCalls: [asked] });
    const { result } = renderHook(() => useAIChat(settings("stopped"), () => doc));

    act(() => {
      void result.current.send("What does Cooking say?");
    });
    await waitFor(() => expect(mockRun).toHaveBeenCalled());
    act(() => {
      result.current.stop();
    });
    // The panel is free again before the call in the app has finished.
    await waitFor(() => expect(result.current.streaming).toBe(false));
    await act(async () => {
      finish(resultOf(asked));
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.turns[1]).toMatchObject({
      content: "Looking.",
      toolCalls: [{ call: asked, status: "stopped" }],
    });
    expect(result.current.turns[1].toolCalls?.[0]?.result).toBeUndefined();
  });

  it("lets a new question take over from a reply whose call is still running", async () => {
    let finish: (result: ToolResult) => void = () => {};
    mockRun.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const chat = vi
      .fn()
      .mockImplementationOnce(async (_messages, options) => {
        options.onChunk("Looking.");
        return { text: "Looking.", toolCalls: [asked] };
      })
      .mockResolvedValue(answer("Travel is a trip."));
    mockCreate.mockReturnValue({ chat });
    const { result } = renderHook(() => useAIChat(settings("overtaken"), () => doc));

    act(() => {
      void result.current.send("What does Cooking say?");
    });
    await waitFor(() => expect(mockRun).toHaveBeenCalled());
    await act(async () => {
      await result.current.send("What about Travel?");
    });
    await act(async () => {
      finish(resultOf(asked));
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.turns.map((turn) => turn.content)).toEqual([
      "What does Cooking say?",
      "Looking.",
      "What about Travel?",
      "Travel is a trip.",
    ]);
    expect(result.current.turns[1].toolCalls?.[0]?.status).toBe("stopped");
    // The overtaken reply goes into the new question as its text alone.
    expect(chat.mock.calls[1][0]).toEqual([
      { role: "user", content: "What does Cooking say?" },
      { role: "assistant", content: "Looking." },
      { role: "user", content: "What about Travel?" },
    ]);
  });

  it("clears the conversation while a call runs, and the late result goes nowhere", async () => {
    let finish: (result: ToolResult) => void = () => {};
    mockRun.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    provider({ text: "", toolCalls: [asked] });
    const { result } = renderHook(() => useAIChat(settings("cleared"), () => doc));

    act(() => {
      void result.current.send("What does Cooking say?");
    });
    await waitFor(() => expect(mockRun).toHaveBeenCalled());
    act(() => {
      result.current.clear();
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    await act(async () => {
      finish(resultOf(asked));
    });

    expect(result.current.turns).toEqual([]);
  });

  it("offers no tools when the window has no workspace to read", async () => {
    const chat = provider(answer("ok"));
    const loose = { content: "# Loose", path: "/elsewhere/Loose.md" };
    const { result } = renderHook(() => useAIChat(settings("loose"), () => loose));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(mockTools).not.toHaveBeenCalled();
    expect(chat.mock.calls[0][1].tools).toEqual([]);
  });

  it("says so on the reply when the call budget ends it", async () => {
    const chat = vi.fn(async () => ({ text: "", toolCalls: [asked] }));
    mockCreate.mockReturnValue({ chat });
    const { result } = renderHook(() => useAIChat(settings("budget"), () => doc));

    await act(async () => {
      await result.current.send("Read everything");
    });

    expect(mockRun).toHaveBeenCalledTimes(MAX_TOOL_CALLS);
    expect(result.current.turns[1].stoppedAtBudget).toBe(true);
    expect(result.current.turns[1].toolCalls).toHaveLength(MAX_TOOL_CALLS);
  });
});
