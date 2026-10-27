import { describe, expect, it, vi } from "vitest";
import { MAX_TOOL_CALLS, runToolLoop, type ToolLoop } from "@/lib/ai/toolLoop";
import type { ChatMessage, ChatOptions, ChatReply, ToolCall, ToolResult } from "@/lib/ai/types";
import { READ_NOTE_TOOL } from "@/test/fixtures/toolTurns";

const call = (id: string, ref = "Index"): ToolCall => ({ id, name: "read_note", input: { ref } });
const ok = (forCall: ToolCall): ToolResult => ({
  callId: forCall.id,
  name: forCall.name,
  content: `{"path":"${String((forCall.input as { ref: string }).ref)}.md"}`,
  isError: false,
});
const abortError = () => new DOMException("aborted", "AbortError");
const answerWith = (text: string): ChatReply => ({ text, toolCalls: [] });

/** A provider that answers each request with the next scripted reply. */
function scripted(
  ...replies: Array<
    ChatReply | ((messages: ChatMessage[], options?: ChatOptions) => Promise<ChatReply>)
  >
) {
  let next = 0;
  return vi.fn(async (messages: ChatMessage[], options?: ChatOptions) => {
    const reply = replies[Math.min(next++, replies.length - 1)];
    return typeof reply === "function" ? reply(messages, options) : reply;
  });
}

function loopOver(chat: ReturnType<typeof scripted>, overrides: Partial<ToolLoop> = {}) {
  const controller = new AbortController();
  const loop: ToolLoop = {
    provider: { chat },
    history: [{ role: "user", content: "What does Cooking say?" }],
    system: "sys",
    tools: [READ_NOTE_TOOL],
    signal: controller.signal,
    onChunk: vi.fn(),
    onCall: vi.fn(),
    onResult: vi.fn(),
    runTool: vi.fn(async (asked: ToolCall) => ok(asked)),
    ...overrides,
  };
  return { loop, controller };
}

/** Every call an assistant message makes has a result right after it. */
function expectReplayable(exchange: ChatMessage[]) {
  exchange.forEach((message, index) => {
    if (message.role !== "assistant" || !message.toolCalls?.length) return;
    const next = exchange[index + 1];
    expect(next?.role).toBe("tool");
    const answered = next?.role === "tool" ? next.results.map((result) => result.callId) : [];
    expect(answered).toEqual(message.toolCalls.map((asked) => asked.id));
  });
}

describe("runToolLoop", () => {
  it("returns an answer that needed no tools", async () => {
    const chat = scripted({ text: "Hello", toolCalls: [] });
    const { loop } = loopOver(chat);

    await expect(runToolLoop(loop)).resolves.toEqual({
      exchange: [{ role: "assistant", content: "Hello" }],
      text: "Hello",
      end: "answered",
    });
    expect(chat.mock.calls[0][1]).toMatchObject({ system: "sys", tools: [READ_NOTE_TOOL] });
  });

  it("runs the calls a reply ends in and asks again with their results", async () => {
    const first = call("a", "Cooking");
    const chat = scripted(
      { text: "Let me look.", toolCalls: [first] },
      { text: "It is about recipes.", toolCalls: [] },
    );
    const { loop } = loopOver(chat);

    const ended = await runToolLoop(loop);

    expect(loop.runTool).toHaveBeenCalledWith(first);
    expect(loop.onCall).toHaveBeenCalledWith(first);
    expect(loop.onResult).toHaveBeenCalledWith(ok(first));
    expect(ended.end).toBe("answered");
    expect(ended.exchange).toEqual([
      { role: "assistant", content: "Let me look.", toolCalls: [first] },
      { role: "tool", results: [ok(first)] },
      { role: "assistant", content: "It is about recipes." },
    ]);
    // The second request carries the question, then the call and its result.
    expect(chat.mock.calls[1][0]).toEqual([...loop.history, ...ended.exchange.slice(0, 2)]);
  });

  it("hands a refusal to the model as an error result", async () => {
    const refused = {
      callId: "x",
      name: "read_note",
      content: "Secret is not in the vault",
      isError: true,
    };
    const chat = scripted(
      { text: "", toolCalls: [call("x", "Secret")] },
      { text: "I cannot read that one.", toolCalls: [] },
    );
    const { loop } = loopOver(chat, { runTool: vi.fn(async () => refused) });

    const ended = await runToolLoop(loop);

    expect(ended.exchange[1]).toEqual({ role: "tool", results: [refused] });
    expect(ended.end).toBe("answered");
  });

  it("stops at the budget, tells the model, and ends when it asks again", async () => {
    const chat = scripted(async (messages) => ({
      text: "",
      toolCalls: [
        call(`c${messages.length}a`),
        call(`c${messages.length}b`),
        call(`c${messages.length}c`),
      ],
    }));
    const { loop } = loopOver(chat);

    const ended = await runToolLoop(loop);

    expect(loop.runTool).toHaveBeenCalledTimes(MAX_TOOL_CALLS);
    expect(ended.end).toBe("budget");
    // The fourth round spends the budget and is told so; asking again in the
    // fifth ends the reply.
    expect(chat).toHaveBeenCalledTimes(5);
    const results = ended.exchange.flatMap((message) =>
      message.role === "tool" ? message.results : [],
    );
    const refusals = results.filter((result) => result.content.includes("used its 10 tool calls"));
    expect(refusals).toHaveLength(5);
    expectReplayable(ended.exchange);
  });

  it("lets the model answer once it is told the budget is spent", async () => {
    const many = Array.from({ length: MAX_TOOL_CALLS + 2 }, (_, i) => call(`c${i}`));
    const chat = scripted(
      { text: "", toolCalls: many },
      { text: "From what I read: recipes.", toolCalls: [] },
    );
    const { loop } = loopOver(chat);

    const ended = await runToolLoop(loop);

    expect(loop.runTool).toHaveBeenCalledTimes(MAX_TOOL_CALLS);
    expect(ended.end).toBe("answered");
    expect(ended.exchange.at(-1)).toEqual({
      role: "assistant",
      content: "From what I read: recipes.",
    });
  });

  it("keeps what streamed when Stop lands mid-stream", async () => {
    let stop = () => {};
    const chat = scripted(async (_messages, options) => {
      options?.onChunk?.("Partial");
      stop();
      throw abortError();
    });
    const { loop, controller } = loopOver(chat);
    stop = () => controller.abort();

    await expect(runToolLoop(loop)).resolves.toEqual({
      exchange: [{ role: "assistant", content: "Partial" }],
      text: "Partial",
      end: "stopped",
    });
    expect(loop.onChunk).toHaveBeenCalledWith("Partial");
  });

  it("runs no further call once Stop lands between calls", async () => {
    const [first, second] = [call("a"), call("b")];
    const chat = scripted({ text: "", toolCalls: [first, second] });
    const { loop, controller } = loopOver(chat, { onResult: vi.fn(() => controller.abort()) });

    const ended = await runToolLoop(loop);

    expect(loop.runTool).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(ended.end).toBe("stopped");
    expect(ended.exchange[1]).toEqual({
      role: "tool",
      results: [ok(first), expect.objectContaining({ callId: "b", isError: true })],
    });
    expectReplayable(ended.exchange);
  });

  it("drops the result of a call still running when Stop lands, and sends nothing more", async () => {
    const asked = call("a");
    let finish: (result: ToolResult) => void = () => {};
    const chat = scripted({ text: "", toolCalls: [asked] });
    const { loop, controller } = loopOver(chat, {
      runTool: vi.fn(() => new Promise<ToolResult>((resolve) => (finish = resolve))),
    });

    const running = runToolLoop(loop);
    await vi.waitFor(() => expect(loop.runTool).toHaveBeenCalled());
    controller.abort();
    // The reply ends without waiting for the call, which finishes later.
    const ended = await running;
    finish(ok(asked));

    expect(loop.onResult).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(ended.end).toBe("stopped");
    const [result] = ended.exchange[1]?.role === "tool" ? ended.exchange[1].results : [];
    expect(result).toMatchObject({ callId: "a", isError: true });
    expect(result?.content).not.toContain("Index.md");
  });

  it("counts a call to a tool it was not offered, and keeps asking for one from looping", async () => {
    const made = { id: "x", name: "web_search", input: {} };
    const chat = scripted({ text: "", toolCalls: [made] });
    const { loop } = loopOver(chat);

    const ended = await runToolLoop(loop);

    expect(loop.runTool).not.toHaveBeenCalled();
    expect(loop.onCall).toHaveBeenCalledTimes(MAX_TOOL_CALLS);
    expect(ended.end).toBe("budget");
    expect(chat).toHaveBeenCalledTimes(MAX_TOOL_CALLS + 2);
    expectReplayable(ended.exchange);
  });

  it("runs no call the reply was not offered, and shows it as failed", async () => {
    const chat = scripted(
      { text: "", toolCalls: [{ id: "x", name: "export", input: { ref: "Index" } }] },
      answerWith("I can only read."),
    );
    const { loop } = loopOver(chat);

    const ended = await runToolLoop(loop);

    expect(loop.runTool).not.toHaveBeenCalled();
    expect(loop.onResult).toHaveBeenCalledWith(expect.objectContaining({ isError: true }));
    expect(ended.exchange[1]).toEqual({
      role: "tool",
      results: [
        expect.objectContaining({
          callId: "x",
          isError: true,
          content: expect.stringContaining("offered"),
        }),
      ],
    });
  });

  it("sets each round's text apart and leaves a blank answer out of the exchange", async () => {
    const chunks: string[] = [];
    const chat = scripted(
      async (_messages, options) => {
        options?.onChunk?.("Let me look.");
        return { text: "Let me look.", toolCalls: [call("a")] };
      },
      async (_messages, options) => {
        options?.onChunk?.("Three notes.");
        return answerWith("Three notes.");
      },
    );
    const { loop } = loopOver(chat, { onChunk: (delta) => chunks.push(delta) });

    const ended = await runToolLoop(loop);

    expect(ended.text).toBe("Let me look.\n\nThree notes.");
    expect(chunks.join("")).toBe(ended.text);

    const blank = scripted({ text: "", toolCalls: [call("a")] }, answerWith(" "));
    const quiet = await runToolLoop(loopOver(blank).loop);
    expect(quiet.text).toBe("");
    expect(quiet.exchange.at(-1)?.role).toBe("tool");
  });

  it("sends nothing for a reply already stopped", async () => {
    const chat = scripted(async (_messages, options) => {
      if (options?.signal?.aborted) throw abortError();
      return answerWith("too late");
    });
    const { loop, controller } = loopOver(chat);
    controller.abort();

    await expect(runToolLoop(loop)).resolves.toEqual({ exchange: [], text: "", end: "stopped" });
  });

  it("passes a provider's own failure through", async () => {
    const chat = scripted(async () => {
      throw new Error("rate limited");
    });
    await expect(runToolLoop(loopOver(chat).loop)).rejects.toThrow("rate limited");
  });
});
