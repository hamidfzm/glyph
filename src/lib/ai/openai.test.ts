import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(result).toBe("Hello");
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
