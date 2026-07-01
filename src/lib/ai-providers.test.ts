import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeProvider,
  createAIProvider,
  fetchOllamaModels,
  OllamaProvider,
  OpenAIProvider,
} from "./ai-providers";
import type { AISettings } from "./settings";

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
});

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
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("llama3.2");
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0]).toEqual({ role: "system", content: "system prompt" });
    expect(result).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("omits system and uses the default model when not provided", async () => {
    const defaultProvider = new OllamaProvider("http://localhost:11434", "");
    mockFetch.mockResolvedValueOnce(streamResponse([]));

    await defaultProvider.chat([{ role: "user", content: "test" }]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(1);
    expect(body.model).toBe("llama3.2");
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server error"),
    });

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
});

describe("fetchOllamaModels", () => {
  it("returns installed model names", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: "gemma2:latest" }, { name: "llama3.2:8b" }] }),
    });

    await expect(fetchOllamaModels("http://localhost:11434")).resolves.toEqual([
      "gemma2:latest",
      "llama3.2:8b",
    ]);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434/api/tags", {
      signal: undefined,
    });
  });

  it("returns empty list when the server reports no models", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await expect(fetchOllamaModels("http://localhost:11434")).resolves.toEqual([]);
  });

  it("throws when the server is unreachable or errors", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });
    await expect(fetchOllamaModels("http://localhost:11434")).rejects.toThrow("Ollama error (502)");
  });
});

describe("createAIProvider", () => {
  const baseSettings: AISettings = {
    provider: "none",
    apiKeys: {},
    ollamaUrl: "http://localhost:11434",
    model: "test-model",
    ttsVoice: "",
    ttsSpeed: 1.0,
  };

  it("returns null for none provider", () => {
    expect(createAIProvider({ ...baseSettings, provider: "none" })).toBeNull();
  });

  it("returns null for unknown provider", () => {
    expect(
      createAIProvider({ ...baseSettings, provider: "unknown" as AISettings["provider"] }),
    ).toBeNull();
  });

  it("returns ClaudeProvider with API key", () => {
    const provider = createAIProvider({
      ...baseSettings,
      provider: "claude",
      apiKeys: { claude: "test-key" },
    });
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  it("returns null for claude without API key", () => {
    expect(createAIProvider({ ...baseSettings, provider: "claude" })).toBeNull();
  });

  it("returns OpenAIProvider with API key", () => {
    const provider = createAIProvider({
      ...baseSettings,
      provider: "openai",
      apiKeys: { openai: "test-key" },
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("returns null for openai without API key", () => {
    expect(createAIProvider({ ...baseSettings, provider: "openai" })).toBeNull();
  });

  it("returns OllamaProvider (no key required)", () => {
    expect(createAIProvider({ ...baseSettings, provider: "ollama" })).toBeInstanceOf(
      OllamaProvider,
    );
  });

  it("uses default ollama URL when empty", () => {
    expect(createAIProvider({ ...baseSettings, provider: "ollama", ollamaUrl: "" })).toBeInstanceOf(
      OllamaProvider,
    );
  });
});
