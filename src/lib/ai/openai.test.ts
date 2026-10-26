import { beforeEach, describe, expect, it, vi } from "vitest";
import { READ_NOTE_TOOL, TOOL_CONVERSATION } from "@/test/fixtures/toolTurns";
import { OpenAIProvider } from "./openai";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

/** Build a fetch Response whose body streams the given lines. */
function streamResponse(lines: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    }),
  };
}

describe("OpenAIProvider", () => {
  const provider = new OpenAIProvider("test-key", "gpt-4o");

  it("sends a streaming request and assembles deltas", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        "data: [DONE]",
      ]),
    );

    const chunks: string[] = [];
    const result = await provider.chat([{ role: "user", content: "test prompt" }], {
      system: "system prompt",
      onChunk: (d) => chunks.push(d),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(result).toEqual({ text: "Hello", toolCalls: [] });
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("omits the system message when not provided and uses the default model", async () => {
    const defaultProvider = new OpenAIProvider("key", "");
    mockFetch.mockResolvedValueOnce(streamResponse(["data: [DONE]"]));

    await defaultProvider.chat([{ role: "user", content: "test" }]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.model).toBe("gpt-4o");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
    });

    await expect(provider.chat([{ role: "user", content: "test" }])).rejects.toThrow(
      "OpenAI API error (429)",
    );
  });
});

describe("OpenAIProvider tool calls", () => {
  const provider = new OpenAIProvider("test-key", "");

  it("offers the tools as functions and sends calls and results as messages", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse(["data: [DONE]"]));

    await provider.chat(TOOL_CONVERSATION, { system: "sys", tools: [READ_NOTE_TOOL] });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "read_note",
          description: "A note's text.",
          parameters: READ_NOTE_TOOL.inputSchema,
        },
      },
    ]);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "What does Cooking say?" },
      {
        role: "assistant",
        content: "Let me look.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_note", arguments: '{"ref":"Cooking"}' },
          },
          {
            id: "call_2",
            type: "function",
            function: { name: "export", arguments: '{"ref":"Cooking"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"content":"Recipes"}' },
      { role: "tool", tool_call_id: "call_2", content: "export is not available here" },
    ]);
  });

  it("offers no tools when none are given", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse(["data: [DONE]"]));
    await provider.chat([{ role: "user", content: "hi" }]);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).tools).toBeUndefined();
  });

  it("assembles each call from the pieces its index carries", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Checking."}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"backlinks","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"ref\\":"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Index\\"}"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"list_tags"}}]}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
      ]),
    );

    const reply = await provider.chat([{ role: "user", content: "What links here?" }], {
      tools: [READ_NOTE_TOOL],
    });

    expect(reply).toEqual({
      text: "Checking.",
      toolCalls: [
        { id: "call_a", name: "backlinks", input: { ref: "Index" } },
        { id: "call_b", name: "list_tags", input: {} },
      ],
    });
  });

  it("passes arguments that do not parse on as text, and replays them unchanged", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read_note","arguments":"{oops"}}]}}]}',
      ]),
    );
    const reply = await provider.chat([{ role: "user", content: "hi" }], {
      tools: [READ_NOTE_TOOL],
    });
    expect(reply.toolCalls).toEqual([{ id: "call_a", name: "read_note", input: "{oops" }]);

    mockFetch.mockResolvedValueOnce(streamResponse(["data: [DONE]"]));
    await provider.chat([{ role: "assistant", content: "", toolCalls: reply.toolCalls }]);
    const replayed = JSON.parse(mockFetch.mock.calls[1][1].body).messages[0];
    expect(replayed).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_a", type: "function", function: { name: "read_note", arguments: "{oops" } },
      ],
    });
  });
});
