import { beforeEach, describe, expect, it, vi } from "vitest";
import { ollamaFetch } from "@/lib/ai/ollamaFetch";
import { ToolsUnsupportedError } from "@/lib/ai/types";
import { READ_NOTE_TOOL, TOOL_CONVERSATION } from "@/test/fixtures/toolTurns";
import { fetchOllamaModels, OllamaProvider } from "./ollama";

vi.mock("@/lib/ai/ollamaFetch", () => ({ ollamaFetch: vi.fn() }));
const mockFetch = vi.mocked(ollamaFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

/** A Response whose body streams the given lines. */
function streamResponse(lines: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    }),
  );
}

/** The JSON body of the n-th request. */
const sentBody = (n = 0) => mockFetch.mock.calls[n][2]?.body as Record<string, unknown>;

describe("OllamaProvider", () => {
  const provider = new OllamaProvider("http://localhost:11434", "llama3.2");

  it("sends a streaming chat request and assembles deltas", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        '{"message":{"role":"assistant","content":"Hel"},"done":false}',
        '{"message":{"role":"assistant","content":"lo"},"done":true}',
      ]),
    );

    const chunks: string[] = [];
    const result = await provider.chat(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hey" },
        { role: "user", content: "test prompt" },
      ],
      { system: "system prompt", onChunk: (d) => chunks.push(d) },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434",
      "chat",
      expect.objectContaining({ body: expect.any(Object) }),
    );

    const body = sentBody();
    expect(body.model).toBe("llama3.2");
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(4);
    expect((body.messages as unknown[])[0]).toEqual({ role: "system", content: "system prompt" });
    expect(result).toEqual({ text: "Hello", toolCalls: [] });
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("omits system and uses the default model when not provided", async () => {
    const defaultProvider = new OllamaProvider("http://localhost:11434", "");
    mockFetch.mockResolvedValueOnce(streamResponse([]));

    await defaultProvider.chat([{ role: "user", content: "test" }]);

    const body = sentBody();
    expect(body.messages).toHaveLength(1);
    expect(body.model).toBe("llama3.2");
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Server error", { status: 500 }));

    await expect(provider.chat([{ role: "user", content: "test" }])).rejects.toThrow(
      "Ollama error (500)",
    );
  });

  it("throws when the stream carries an error", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse(['{"error":"model not found"}']));

    await expect(provider.chat([{ role: "user", content: "test" }])).rejects.toThrow(
      "model not found",
    );
  });

  it("skips blank and malformed NDJSON lines", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        "",
        "   ",
        "{not json",
        '{"done":false}',
        '{"message":{"role":"assistant","content":"ok"},"done":true}',
      ]),
    );

    await expect(provider.chat([{ role: "user", content: "test" }])).resolves.toEqual({
      text: "ok",
      toolCalls: [],
    });
  });
});

describe("OllamaProvider tool calls", () => {
  const provider = new OllamaProvider("http://localhost:11434", "qwen3");

  it("offers the tools as functions and sends calls and results by tool name", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([]));

    await provider.chat(TOOL_CONVERSATION, { tools: [READ_NOTE_TOOL] });

    const body = sentBody();
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
      { role: "user", content: "What does Cooking say?" },
      {
        role: "assistant",
        content: "Let me look.",
        tool_calls: [
          { function: { name: "read_note", arguments: { ref: "Cooking" } } },
          { function: { name: "export", arguments: { ref: "Cooking" } } },
        ],
      },
      { role: "tool", tool_name: "read_note", content: '{"content":"Recipes"}' },
      { role: "tool", tool_name: "export", content: "export is not available here" },
    ]);
  });

  it("collects whole calls from the stream, naming those that come without an id", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        '{"message":{"role":"assistant","content":"Checking."},"done":false}',
        '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"backlinks","arguments":{"ref":"Index"}}}]},"done":false}',
        '{"message":{"role":"assistant","content":"","tool_calls":[{"id":"x","function":{"name":"list_tags","arguments":"{}"}},{"function":{"name":"vault_context"}},{}]},"done":true}',
      ]),
    );

    const reply = await provider.chat([{ role: "user", content: "What links here?" }], {
      tools: [READ_NOTE_TOOL],
    });

    expect(reply).toEqual({
      text: "Checking.",
      toolCalls: [
        { id: "call_0", name: "backlinks", input: { ref: "Index" } },
        { id: "x", name: "list_tags", input: {} },
        { id: "call_1", name: "vault_context", input: {} },
        { id: "call_2", name: "", input: {} },
      ],
    });
  });

  it("names calls without an id uniquely across a reply's rounds", async () => {
    const unnamed =
      '{"message":{"content":"","tool_calls":[{"function":{"name":"list_tags"}}]},"done":true}';
    const reply = new OllamaProvider("http://localhost:11434", "qwen3");
    mockFetch.mockResolvedValueOnce(streamResponse([unnamed]));
    mockFetch.mockResolvedValueOnce(streamResponse([unnamed]));

    const first = await reply.chat([{ role: "user", content: "hi" }], { tools: [READ_NOTE_TOOL] });
    const second = await reply.chat([{ role: "user", content: "hi" }], { tools: [READ_NOTE_TOOL] });

    expect(first.toolCalls[0]?.id).not.toBe(second.toolCalls[0]?.id);
  });

  it("reports a model that refuses tool definitions as unable to use tools", async () => {
    const refusal = () =>
      new Response('{"error":"registry.ollama.ai/library/gemma:2b does not support tools"}', {
        status: 400,
      });
    mockFetch.mockResolvedValueOnce(refusal());
    await expect(
      provider.chat([{ role: "user", content: "hi" }], { tools: [READ_NOTE_TOOL] }),
    ).rejects.toBeInstanceOf(ToolsUnsupportedError);

    // Without tools offered, the same refusal is an ordinary error.
    mockFetch.mockResolvedValueOnce(refusal());
    const plain = await provider.chat([{ role: "user", content: "hi" }]).catch((err) => err);
    expect(plain).not.toBeInstanceOf(ToolsUnsupportedError);
    expect(String(plain)).toContain("Ollama error (400)");
  });
});

describe("fetchOllamaModels", () => {
  const jsonResponse = (data: unknown) => new Response(JSON.stringify(data));

  it("returns installed model names", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ models: [{ name: "gemma2:latest" }, { name: "llama3.2:8b" }] }),
    );

    await expect(fetchOllamaModels("http://localhost:11434")).resolves.toEqual([
      "gemma2:latest",
      "llama3.2:8b",
    ]);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434", "tags", {
      signal: undefined,
    });
  });

  it("returns empty list when the server reports no models", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(fetchOllamaModels("http://localhost:11434")).resolves.toEqual([]);
  });

  it("drops entries without a name", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ models: [{ name: "good:latest" }, { size: 1 }] }),
    );
    await expect(fetchOllamaModels("http://localhost:11434")).resolves.toEqual(["good:latest"]);
  });

  it("throws when the server is unreachable or errors", async () => {
    const cancel = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 502 }));
    await expect(fetchOllamaModels("http://localhost:11434")).rejects.toThrow("Ollama error (502)");
    // The unread body is dropped, which closes the backend's reply.
    expect(cancel).toHaveBeenCalled();
  });
});
