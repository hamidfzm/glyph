import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(result).toBe("Hello");
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

    await expect(provider.chat([{ role: "user", content: "test" }])).resolves.toBe("ok");
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

    await expect(provider.chat([{ role: "user", content: "test" }])).resolves.toBe("whole");
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

    await expect(provider.chat([{ role: "user", content: "test" }])).resolves.toBe("tail");
  });
});
