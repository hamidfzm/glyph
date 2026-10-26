import { describe, expect, it } from "vitest";
import {
  type ChatTurn,
  chatHistory,
  withReplyEnded,
  withRunningStopped,
  withToolCall,
  withToolResult,
} from "@/lib/ai/chatTurn";
import type { ChatMessage, ToolCall } from "@/lib/ai/types";

const asked: ToolCall = { id: "a", name: "backlinks", input: { ref: "Index" } };
const exchange: ChatMessage[] = [
  { role: "assistant", content: "Checking. ", toolCalls: [asked] },
  {
    role: "tool",
    results: [{ callId: "a", name: "backlinks", content: "{}", isError: false }],
  },
  { role: "assistant", content: "Nothing links here." },
];
const reply: ChatTurn = {
  id: 2,
  role: "assistant",
  content: "Checking. Nothing links here.",
  exchange,
};
const question: ChatTurn = { id: 1, role: "user", content: "What links here?" };

describe("chatHistory", () => {
  it("replays a reply's calls and results while tools are offered", () => {
    expect(chatHistory([question, reply], true)).toEqual([
      { role: "user", content: "What links here?" },
      ...exchange,
    ]);
  });

  it("keeps only a reply's text when no tools are offered", () => {
    expect(chatHistory([question, reply], false)).toEqual([
      { role: "user", content: "What links here?" },
      { role: "assistant", content: "Checking. Nothing links here." },
    ]);
  });

  it("leaves out a reply that has no text and no exchange", () => {
    const empty: ChatTurn = { id: 3, role: "assistant", content: " " };
    expect(chatHistory([question, empty], true)).toEqual([
      { role: "user", content: "What links here?" },
    ]);
  });

  it("replays only the latest reply's calls, so earlier results are not sent again", () => {
    const later: ChatTurn = { ...reply, id: 4, content: "Still nothing." };
    const again: ChatTurn = { id: 3, role: "user", content: "And now?" };
    expect(chatHistory([question, reply, again, later], true)).toEqual([
      { role: "user", content: "What links here?" },
      { role: "assistant", content: "Checking. Nothing links here." },
      { role: "user", content: "And now?" },
      ...exchange,
    ]);
  });
});

describe("tool call views", () => {
  const start: ChatTurn = { id: 2, role: "assistant", content: "" };

  it("settles the running call with its result, keyed by its place in the reply", () => {
    const second: ToolCall = { ...asked, id: "a" };
    let turn = withToolCall(start, asked);
    turn = withToolResult(turn, { callId: "a", name: "backlinks", content: "{}", isError: false });
    turn = withToolCall(turn, second);
    turn = withToolResult(turn, { callId: "a", name: "backlinks", content: "no", isError: true });

    expect(turn.toolCalls).toEqual([
      { key: 0, call: asked, status: "done", result: "{}" },
      { key: 1, call: second, status: "failed", result: "no" },
    ]);
  });

  it("marks a call still running as stopped, and leaves a turn without one alone", () => {
    const running = withToolCall(start, asked);
    expect(withRunningStopped(running).toolCalls?.[0]?.status).toBe("stopped");
    expect(withRunningStopped(start)).toBe(start);
  });

  it("ends a reply with the loop's text and says when the budget ended it", () => {
    const text = "Checking. Nothing links here.";
    const ended = withReplyEnded(withToolCall(start, asked), { exchange, text, end: "budget" });
    expect(ended.content).toBe(text);
    expect(ended.exchange).toBe(exchange);
    expect(ended.stoppedAtBudget).toBe(true);
    expect(ended.toolCalls?.[0]?.status).toBe("stopped");
    expect(withReplyEnded(start, { exchange, text, end: "answered" }).stoppedAtBudget).toBe(false);
  });
});
