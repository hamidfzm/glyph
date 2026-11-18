import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaUnreachableError, OllamaUrlError } from "@/lib/ai/types";
import { deferred } from "@/test/deferred";
import { ollamaFetch } from "./ollamaFetch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

type Handler = (args: Record<string, unknown>) => unknown;

/** Answer each command with its handler; a command without one resolves empty. */
function backend(handlers: Record<string, Handler>) {
  mockInvoke.mockImplementation(((cmd: string, args: Record<string, unknown>) =>
    Promise.resolve().then(() => handlers[cmd]?.(args))) as unknown as typeof invoke);
}

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

/** `ollama_read` answering with each chunk in turn, then the empty end. */
function reads(...chunks: string[]): Handler {
  const queue = chunks.map(bytes);
  return () => queue.shift() ?? new ArrayBuffer(0);
}

const callsTo = (cmd: string) =>
  mockInvoke.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args);

const BASE = "http://localhost:11434";

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("ollamaFetch", () => {
  it("opens, sends and streams the reply until an empty chunk", async () => {
    backend({ ollama_open: () => 7, ollama_send: () => 200, ollama_read: reads("ab", "c") });

    const response = await ollamaFetch(BASE, "chat", { body: { model: "m" } });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc");
    expect(callsTo("ollama_open")).toEqual([
      { baseUrl: BASE, endpoint: "chat", body: { model: "m" } },
    ]);
    expect(callsTo("ollama_send")).toEqual([{ rid: 7 }]);
    expect(callsTo("ollama_read")).toEqual([{ rid: 7 }, { rid: 7 }, { rid: 7 }]);
    expect(callsTo("ollama_cancel")).toEqual([]);
  });

  it("opens with a null body and hands back an error status with its body", async () => {
    backend({ ollama_open: () => 1, ollama_send: () => 502, ollama_read: reads("bad gateway") });

    const response = await ollamaFetch(BASE, "tags");

    expect(callsTo("ollama_open")[0]).toMatchObject({ endpoint: "tags", body: null });
    expect(response.ok).toBe(false);
    expect(await response.text()).toBe("bad gateway");
  });

  it("reports a refused URL before anything is sent", async () => {
    backend({
      ollama_open: () => {
        throw "the URL must start with http:// or https://";
      },
    });

    const err = await ollamaFetch("localhost:11434", "tags").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OllamaUrlError);
    expect(err).toMatchObject({ url: "localhost:11434" });
    expect(callsTo("ollama_send")).toEqual([]);
  });

  it("reports a send that got no reply as an unreachable server", async () => {
    backend({
      ollama_open: () => 3,
      ollama_send: () => {
        throw "connection refused";
      },
    });

    const err = await ollamaFetch(BASE, "chat", { body: {} }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OllamaUnreachableError);
    expect(err).toMatchObject({ url: BASE, reason: "connection refused" });
  });

  it("errors the body when a read fails", async () => {
    backend({
      ollama_open: () => 2,
      ollama_send: () => 200,
      ollama_read: () => {
        throw "connection reset";
      },
    });

    const response = await ollamaFetch(BASE, "chat", { body: {} });

    await expect(response.body?.getReader().read()).rejects.toBe("connection reset");
  });

  it("cancelling the body cancels the request", async () => {
    backend({ ollama_open: () => 4, ollama_send: () => 200 });

    const response = await ollamaFetch(BASE, "chat", { body: {} });
    await response.body?.cancel();

    expect(callsTo("ollama_cancel")).toEqual([{ rid: 4 }]);
  });
});

describe("ollamaFetch cancellation", () => {
  it("opens nothing for a signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(ollamaFetch(BASE, "tags", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("cancels a request opened while the abort landed, without sending it", async () => {
    const controller = new AbortController();
    backend({
      ollama_open: () => {
        controller.abort();
        return 8;
      },
    });

    await expect(
      ollamaFetch(BASE, "chat", { body: {}, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(callsTo("ollama_cancel")).toEqual([{ rid: 8 }]);
    expect(callsTo("ollama_send")).toEqual([]);
  });

  it("cancels a pending send and rejects with the abort", async () => {
    const sent = deferred<unknown>();
    backend({ ollama_open: () => 9, ollama_send: () => sent.promise });
    const controller = new AbortController();

    const response = ollamaFetch(BASE, "chat", { body: {}, signal: controller.signal });
    await vi.waitFor(() => expect(callsTo("ollama_send")).toHaveLength(1));
    controller.abort();

    expect(callsTo("ollama_cancel")).toEqual([{ rid: 9 }]);
    // The backend ends the cancelled send with an error of its own.
    sent.reject("cancelled");
    await expect(response).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects with the abort when it lands as the status arrives", async () => {
    const controller = new AbortController();
    backend({
      ollama_open: () => 6,
      ollama_send: () => {
        controller.abort();
        return 200;
      },
    });

    await expect(
      ollamaFetch(BASE, "chat", { body: {}, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(callsTo("ollama_cancel")).toEqual([{ rid: 6 }]);
    expect(callsTo("ollama_read")).toEqual([]);
  });

  it("cancels a pending read and errors the body with the abort", async () => {
    const read = deferred<unknown>();
    backend({ ollama_open: () => 5, ollama_send: () => 200, ollama_read: () => read.promise });
    const controller = new AbortController();

    const response = await ollamaFetch(BASE, "chat", { body: {}, signal: controller.signal });
    const pending = response.body?.getReader().read();
    await vi.waitFor(() => expect(callsTo("ollama_read")).toHaveLength(1));
    controller.abort();

    expect(callsTo("ollama_cancel")).toEqual([{ rid: 5 }]);
    read.reject("cancelled");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
