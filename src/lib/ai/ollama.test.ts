import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOllamaModels, OllamaProvider } from "./ollama";

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

    await expect(provider.chat([{ role: "user", content: "test" }])).resolves.toBe("ok");
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

  it("drops entries without a name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: "good:latest" }, { size: 1 }] }),
    });
    await expect(fetchOllamaModels("http://localhost:11434")).resolves.toEqual(["good:latest"]);
  });

  it("throws when the server is unreachable or errors", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });
    await expect(fetchOllamaModels("http://localhost:11434")).rejects.toThrow("Ollama error (502)");
  });
});
