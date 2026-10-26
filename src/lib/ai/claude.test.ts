import { beforeEach, describe, expect, it, vi } from "vitest";
import { READ_NOTE_TOOL, TOOL_CONVERSATION } from "@/test/fixtures/toolTurns";
import { ClaudeProvider } from "./claude";

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

describe("ClaudeProvider", () => {
  const provider = new ClaudeProvider("test-key", "claude-sonnet-4-20250514");

  it("sends a streaming request and assembles deltas", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        'data: {"type":"message_start"}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
        'data: {"type":"message_stop"}',
      ]),
    );

    const chunks: string[] = [];
    const result = await provider.chat([{ role: "user", content: "test prompt" }], {
      system: "system prompt",
      onChunk: (d) => chunks.push(d),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.system).toBe("system prompt");
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toBe("test prompt");
    expect(result).toEqual({ text: "Hello", toolCalls: [] });
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("omits system when not provided and uses the default model", async () => {
    const defaultProvider = new ClaudeProvider("key", "");
    mockFetch.mockResolvedValueOnce(streamResponse([]));

    await defaultProvider.chat([{ role: "user", content: "test" }]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBeUndefined();
    expect(body.model).toBe("claude-sonnet-4-20250514");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(provider.chat([{ role: "user", content: "test" }])).rejects.toThrow(
      "Claude API error (401)",
    );
  });

  it("throws when the stream carries an error event", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse(['data: {"type":"error","error":{"message":"overloaded"}}']),
    );

    await expect(provider.chat([{ role: "user", content: "test" }])).rejects.toThrow("overloaded");
  });

  it("falls back to a generic message when the stream error carries none", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse(['data: {"type":"error","error":{}}']));

    await expect(provider.chat([{ role: "user", content: "test" }])).rejects.toThrow(
      "stream error",
    );
  });

  it("ignores malformed, empty, and non-delta SSE lines", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        "event: content_block_delta",
        "data:",
        "data: {broken json",
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]),
    );

    await expect(provider.chat([{ role: "user", content: "test" }])).resolves.toEqual({
      text: "ok",
      toolCalls: [],
    });
  });

  it("falls back to reading the whole body when the response cannot stream", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null,
      text: () =>
        Promise.resolve(
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"whole"}}\n',
        ),
    });

    await expect(provider.chat([{ role: "user", content: "test" }])).resolves.toEqual({
      text: "whole",
      toolCalls: [],
    });
  });

  it("flushes a final line that has no trailing newline", async () => {
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"tail"}}',
            ),
          );
          controller.close();
        },
      }),
    });

    await expect(provider.chat([{ role: "user", content: "test" }])).resolves.toEqual({
      text: "tail",
      toolCalls: [],
    });
  });
});

describe("ClaudeProvider tool calls", () => {
  const provider = new ClaudeProvider("test-key", "");

  it("offers the tools and sends calls and results as content blocks", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([]));

    await provider.chat(TOOL_CONVERSATION, { tools: [READ_NOTE_TOOL] });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toEqual([
      {
        name: "read_note",
        description: "A note's text.",
        input_schema: READ_NOTE_TOOL.inputSchema,
      },
    ]);
    expect(body.messages).toEqual([
      { role: "user", content: "What does Cooking say?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool_use", id: "call_1", name: "read_note", input: { ref: "Cooking" } },
          { type: "tool_use", id: "call_2", name: "export", input: { ref: "Cooking" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: '{"content":"Recipes"}',
            is_error: false,
          },
          {
            type: "tool_result",
            tool_use_id: "call_2",
            content: "export is not available here",
            is_error: true,
          },
        ],
      },
    ]);
  });

  it("offers no tools when none are given", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([]));
    await provider.chat([{ role: "user", content: "hi" }], { tools: [] });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).tools).toBeUndefined();
  });

  it("assembles a reply that ends in tool calls from their argument pieces", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking."}}',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"backlinks","input":{}}}',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"ref\\":"}}',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"Index\\"}"}}',
        'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_2","name":"vault_context","input":{}}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      ]),
    );

    const chunks: string[] = [];
    const reply = await provider.chat([{ role: "user", content: "What links here?" }], {
      tools: [READ_NOTE_TOOL],
      onChunk: (delta) => chunks.push(delta),
    });

    expect(reply).toEqual({
      text: "Checking.",
      toolCalls: [
        { id: "toolu_1", name: "backlinks", input: { ref: "Index" } },
        { id: "toolu_2", name: "vault_context", input: {} },
      ],
    });
    expect(chunks).toEqual(["Checking."]);
  });

  it("passes arguments that do not parse on as text, and replays them as no arguments", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_note"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"ref\\": "}}',
      ]),
    );
    const reply = await provider.chat([{ role: "user", content: "hi" }], {
      tools: [READ_NOTE_TOOL],
    });
    expect(reply.toolCalls).toEqual([{ id: "toolu_1", name: "read_note", input: '{"ref": ' }]);

    mockFetch.mockResolvedValueOnce(streamResponse([]));
    await provider.chat([{ role: "assistant", content: "", toolCalls: reply.toolCalls }], {
      tools: [READ_NOTE_TOOL],
    });
    const replayed = JSON.parse(mockFetch.mock.calls[1][1].body).messages[0];
    expect(replayed.content).toEqual([
      { type: "tool_use", id: "toolu_1", name: "read_note", input: {} },
    ]);
  });

  it("sends no blank text, which the API refuses anywhere but last", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([]));
    await provider.chat(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "  " },
        { role: "user", content: "again" },
        {
          role: "assistant",
          content: "\n",
          toolCalls: [{ id: "t", name: "list_tags", input: {} }],
        },
      ],
      { tools: [READ_NOTE_TOOL] },
    );
    const { messages } = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(messages).toEqual([
      { role: "user", content: "hi" },
      { role: "user", content: "again" },
      { role: "assistant", content: [{ type: "tool_use", id: "t", name: "list_tags", input: {} }] },
    ]);
  });
});
