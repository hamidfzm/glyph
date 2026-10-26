import type {
  AIProvider,
  ChatMessage,
  ChatReply,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "@/lib/ai/types";

/** Most tool calls one question may make. */
export const MAX_TOOL_CALLS = 10;

const BUDGET_SPENT = `Not run: this question has used its ${MAX_TOOL_CALLS} tool calls. Answer now from what you have, and say what you could not check.`;
const STOPPED = "Not run: the user stopped the reply.";
const NOT_OFFERED = "Not run: no tool by this name was offered.";
/** Between the texts of two rounds, so they read as two paragraphs. */
const ROUND_BREAK = "\n\n";

export interface ToolLoop {
  provider: AIProvider;
  /** The conversation so far, ending with the question. */
  history: ChatMessage[];
  system: string;
  tools: readonly ToolDefinition[];
  signal: AbortSignal;
  onChunk: (delta: string) => void;
  /** A call is about to run. Calls run one at a time. */
  onCall: (call: ToolCall) => void;
  /** The result of the call that started last, unless Stop came first. */
  onResult: (result: ToolResult) => void;
  runTool: (call: ToolCall) => Promise<ToolResult>;
}

export interface ToolLoopEnd {
  /** What the reply added to the conversation: each round's text and
   *  calls, and the results they got, so a later question replays it. */
  exchange: ChatMessage[];
  /** The reply's text, one paragraph per round that said something. */
  text: string;
  end: "answered" | "stopped" | "budget";
}

function notRun(call: ToolCall, content: string): ToolResult {
  return { callId: call.id, name: call.name, content, isError: true };
}

/** Settles once the user stops the reply. */
function stopping(signal: AbortSignal): Promise<null> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(null);
    signal.addEventListener("abort", () => resolve(null), { once: true });
  });
}

/**
 * Ask, run the calls the reply ends in, and ask again, until the model
 * answers, the user stops it, or the call budget is spent. Every call a reply
 * makes gets a result, run or not, so the exchange always replays cleanly.
 */
export async function runToolLoop(loop: ToolLoop): Promise<ToolLoopEnd> {
  const exchange: ChatMessage[] = [];
  const offered = new Set(loop.tools.map((tool) => tool.name));
  const stopped = stopping(loop.signal);
  let text = "";
  let used = 0;
  let toldBudgetSpent = false;
  const keep = (part: string) => {
    if (part.trim()) text = text ? `${text}${ROUND_BREAK}${part}` : part;
  };
  // A blank text is no message: the Anthropic API refuses one mid-history.
  const said = (part: string) => {
    keep(part);
    if (part.trim()) exchange.push({ role: "assistant", content: part });
  };

  for (;;) {
    let streamed = "";
    let reply: ChatReply;
    try {
      reply = await loop.provider.chat([...loop.history, ...exchange], {
        system: loop.system,
        signal: loop.signal,
        tools: loop.tools,
        onChunk: (delta) => {
          if (!streamed && text) loop.onChunk(ROUND_BREAK);
          streamed += delta;
          loop.onChunk(delta);
        },
      });
    } catch (err) {
      const isStop =
        loop.signal.aborted || (err instanceof DOMException && err.name === "AbortError");
      if (!isStop) throw err;
      said(streamed);
      return { exchange, text, end: "stopped" };
    }
    if (reply.toolCalls.length === 0) {
      said(reply.text);
      return { exchange, text, end: "answered" };
    }
    keep(reply.text);
    exchange.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });

    const results: ToolResult[] = [];
    let refusedForBudget = false;
    for (const call of reply.toolCalls) {
      if (loop.signal.aborted) {
        results.push(notRun(call, STOPPED));
        continue;
      }
      // A provider may return a call it was not offered; it is not run.
      if (!offered.has(call.name)) {
        results.push(notRun(call, NOT_OFFERED));
        continue;
      }
      if (used >= MAX_TOOL_CALLS) {
        refusedForBudget = true;
        results.push(notRun(call, BUDGET_SPENT));
        continue;
      }
      used += 1;
      loop.onCall(call);
      // A call already running in the app finishes there, but the reply does
      // not wait for it once the user stops, and what it found is not sent.
      const result = await Promise.race([loop.runTool(call), stopped]);
      if (result === null || loop.signal.aborted) {
        results.push(notRun(call, STOPPED));
        continue;
      }
      loop.onResult(result);
      results.push(result);
    }
    exchange.push({ role: "tool", results });
    if (loop.signal.aborted) return { exchange, text, end: "stopped" };
    // The model gets one round to answer after it is told; asking again ends it.
    if (refusedForBudget && toldBudgetSpent) return { exchange, text, end: "budget" };
    toldBudgetSpent ||= refusedForBudget;
  }
}
