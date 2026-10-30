import type { ToolLoopEnd } from "@/lib/ai/toolLoop";
import type { ChatMessage, ToolCall, ToolResult } from "@/lib/ai/types";

export interface ToolCallView {
  /** Its place in the reply, unique where a call id need not be. */
  key: number;
  call: ToolCall;
  status: "running" | "done" | "failed" | "stopped";
  result?: string;
}

export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  /** What is sent to the model. */
  content: string;
  /** Short label shown in the transcript instead of `content` (quick actions
   *  embed long passages the user shouldn't have to re-read). */
  display?: string;
  /** Image URLs the document named when this reply was requested; a reply
   *  image loads only when its URL is among them. Assistant turns only. */
  quotedImageUrls?: readonly string[];
  /** The tools this reply called, in order. Assistant turns only. */
  toolCalls?: ToolCallView[];
  /** What the reply sent and received, replayed while tools are offered. */
  exchange?: ChatMessage[];
  /** The reply ended at the tool call budget. */
  stoppedAtBudget?: boolean;
  /** The tools were wanted, but the model takes none, so it answered without them. */
  toolsSkipped?: boolean;
}

/**
 * The conversation so far as a provider reads it. With tools offered, the
 * latest reply replays its calls and their results, and every other reply only
 * its text, so what the tools read is not sent again with each question. A
 * request that offers no tools may not carry them at all.
 */
export function chatHistory(turns: readonly ChatTurn[], withTools: boolean): ChatMessage[] {
  const latest = [...turns].reverse().find((turn) => turn.role === "assistant");
  const replayed = withTools ? latest : undefined;
  return turns.flatMap((turn): ChatMessage[] => {
    if (turn.role === "user") return [{ role: "user", content: turn.content }];
    if (turn === replayed && turn.exchange) return turn.exchange;
    // A blank text is no message: the Anthropic API refuses one mid-history.
    return turn.content.trim() ? [{ role: "assistant", content: turn.content }] : [];
  });
}

export function withToolCall(turn: ChatTurn, call: ToolCall): ChatTurn {
  const calls = turn.toolCalls ?? [];
  return { ...turn, toolCalls: [...calls, { key: calls.length, call, status: "running" }] };
}

/** Calls run one at a time, so a result is the running call's. */
export function withToolResult(turn: ChatTurn, result: ToolResult): ChatTurn {
  const status: ToolCallView["status"] = result.isError ? "failed" : "done";
  const toolCalls = turn.toolCalls?.map((view) =>
    view.status === "running" ? { ...view, status, result: result.content } : view,
  );
  return { ...turn, toolCalls };
}

/** A call still running when the reply ended was stopped: its result never reached the model. */
export function withRunningStopped(turn: ChatTurn): ChatTurn {
  if (!turn.toolCalls?.some((view) => view.status === "running")) return turn;
  const toolCalls = turn.toolCalls.map((view) =>
    view.status === "running" ? { ...view, status: "stopped" as const } : view,
  );
  return { ...turn, toolCalls };
}

/** The turn once its reply ended, its text exactly what the reply said. */
export function withReplyEnded(turn: ChatTurn, { exchange, text, end }: ToolLoopEnd): ChatTurn {
  return {
    ...withRunningStopped(turn),
    content: text,
    exchange,
    stoppedAtBudget: end === "budget",
  };
}
