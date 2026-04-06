import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeProvider, createAIProvider, OllamaProvider, OpenAIProvider } from "./ai-providers";
import type { AISettings } from "./settings";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ClaudeProvider", () => {
  const provider = new ClaudeProvider("test-key", "claude-sonnet-4-20250514");

  it("sends correct request to Claude API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: "response" }] }),
    });

    const result = await provider.complete("test prompt", "system prompt");

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
    expect(body.messages[0].content).toBe("test prompt");
    expect(result).toBe("response");
  });

  it("sends request without system prompt when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: "hi" }] }),
    });

    await provider.complete("test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBeUndefined();
  });

  it("uses default model when none specified", async () => {
    const defaultProvider = new ClaudeProvider("key", "");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: "" }] }),
    });

    await defaultProvider.complete("test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-sonnet-4-20250514");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(provider.complete("test")).rejects.toThrow("Claude API error (401)");
  });

  it("returns empty string when content is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await provider.complete("test");
    expect(result).toBe("");
  });
});

describe("OpenAIProvider", () => {
  const provider = new OpenAIProvider("test-key", "gpt-4o");

  it("sends correct request to OpenAI API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "response" } }],
        }),
    });

    const result = await provider.complete("test prompt", "system prompt");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(result).toBe("response");
  });

  it("omits system message when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "hi" } }] }),
    });

    await provider.complete("test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("uses default model when none specified", async () => {
    const defaultProvider = new OpenAIProvider("key", "");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "" } }] }),
    });

    await defaultProvider.complete("test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
    });

    await expect(provider.complete("test")).rejects.toThrow("OpenAI API error (429)");
  });

  it("returns empty string when choices are missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await provider.complete("test");
    expect(result).toBe("");
  });
});

describe("OllamaProvider", () => {
  const provider = new OllamaProvider("http://localhost:11434", "llama3.2");

  it("sends correct request to Ollama", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: "reply" }),
    });

    const result = await provider.complete("test prompt", "system prompt");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({ method: "POST" }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("llama3.2");
    expect(body.prompt).toContain("system prompt");
    expect(body.prompt).toContain("test prompt");
    expect(body.stream).toBe(false);
    expect(result).toBe("reply");
  });

  it("sends prompt without system when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: "ok" }),
    });

    await provider.complete("just a prompt");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.prompt).toBe("just a prompt");
  });

  it("uses default model when none specified", async () => {
    const defaultProvider = new OllamaProvider("http://localhost:11434", "");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: "" }),
    });

    await defaultProvider.complete("test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("llama3.2");
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server error"),
    });

    await expect(provider.complete("test")).rejects.toThrow("Ollama error (500)");
  });

  it("returns empty string when response is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await provider.complete("test");
    expect(result).toBe("");
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
    const provider = createAIProvider({
      ...baseSettings,
      provider: "claude",
    });
    expect(provider).toBeNull();
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
    const provider = createAIProvider({
      ...baseSettings,
      provider: "openai",
    });
    expect(provider).toBeNull();
  });

  it("returns OllamaProvider (no key required)", () => {
    const provider = createAIProvider({
      ...baseSettings,
      provider: "ollama",
    });
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it("uses default ollama URL when empty", () => {
    const provider = createAIProvider({
      ...baseSettings,
      provider: "ollama",
      ollamaUrl: "",
    });
    expect(provider).toBeInstanceOf(OllamaProvider);
  });
});
