import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaUnreachableError } from "@/lib/ai/types";
import { deferred } from "@/test/deferred";
import { ollamaFetch } from "./ollamaFetch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

type Handler = (args: Record<string, unknown>) => unknown;

/** Answer each command with its handler; a command without one resolves empty. */
function backend(handlers: Record<string, Handler>) {
  mockInvoke.mockImplementation(((cmd: string, args: Record<string, unknown>) =>
    Promise.resolve(handlers[cmd]?.(args))) as unknown as typeof invoke);
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
  it("sends through the backend and streams the reply until an empty chunk", async () => {
    backend({ ollama_send: () => ({ rid: 7, status: 200 }), ollama_read: reads("ab", "c") });

    const response = await ollamaFetch(BASE, "chat", { body: { model: "m" } });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc");
    expect(callsTo("ollama_send")).toEqual([
      { baseUrl: BASE, endpoint: "chat", body: { model: "m" } },
    ]);
    expect(callsTo("ollama_read")).toEqual([{ rid: 7 }, { rid: 7 }, { rid: 7 }]);
    expect(callsTo("ollama_cancel")).toEqual([]);
  });

  it("sends no body as null and hands back an error status with its body", async () => {
    backend({ ollama_send: () => ({ rid: 1, status: 502 }), ollama_read: reads("bad gateway") });

    const response = await ollamaFetch(BASE, "tags");

    expect(callsTo("ollama_send")[0]).toMatchObject({ endpoint: "tags", body: null });
    expect(response.ok).toBe(false);
    expect(await response.text()).toBe("bad gateway");
  });

  it("reports a send the backend could not complete as an unreachable server", async () => {
    mockInvoke.mockRejectedValueOnce("connection refused");

    const err = await ollamaFetch(BASE, "chat", { body: {} }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OllamaUnreachableError);
    expect(err).toMatchObject({ url: BASE, reason: "connection refused" });
  });

  it("errors the body when a read fails", async () => {
    backend({
      ollama_send: () => ({ rid: 2, status: 200 }),
      ollama_read: () => {
        throw "connection reset";
      },
    });

    const response = await ollamaFetch(BASE, "chat", { body: {} });

    await expect(response.body?.getReader().read()).rejects.toBe("connection reset");
  });

  it("cancelling the body drops the reply", async () => {
    backend({ ollama_send: () => ({ rid: 4, status: 200 }) });

    const response = await ollamaFetch(BASE, "chat", { body: {} });
    await response.body?.cancel();

    expect(callsTo("ollama_cancel")).toEqual([{ rid: 4 }]);
  });
});

describe("ollamaFetch cancellation", () => {
  it("sends nothing for a signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(ollamaFetch(BASE, "tags", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("rejects at once while the status is pending and drops the reply that comes later", async () => {
    const sent = deferred<unknown>();
    backend({ ollama_send: () => sent.promise });
    const controller = new AbortController();

    const response = ollamaFetch(BASE, "chat", { body: {}, signal: controller.signal });
    controller.abort();

    await expect(response).rejects.toMatchObject({ name: "AbortError" });
    sent.resolve({ rid: 9, status: 200 });
    await vi.waitFor(() => expect(callsTo("ollama_cancel")).toEqual([{ rid: 9 }]));
  });

  it("drops the reply when the abort lands as the status arrives", async () => {
    const controller = new AbortController();
    backend({
      ollama_send: () => {
        queueMicrotask(() => controller.abort());
        return { rid: 6, status: 200 };
      },
    });

    await expect(
      ollamaFetch(BASE, "chat", { body: {}, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(callsTo("ollama_cancel")).toEqual([{ rid: 6 }]));
    expect(callsTo("ollama_read")).toEqual([]);
  });

  it("errors a pending read and cancels the reply when aborted during the body", async () => {
    const read = deferred<unknown>();
    backend({ ollama_send: () => ({ rid: 5, status: 200 }), ollama_read: () => read.promise });
    const controller = new AbortController();

    const response = await ollamaFetch(BASE, "chat", { body: {}, signal: controller.signal });
    const reader = response.body?.getReader();
    const pending = reader?.read();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(callsTo("ollama_cancel")).toEqual([{ rid: 5 }]);
    // The read answering late lands nowhere.
    read.resolve(bytes("late"));
    await expect(reader?.read()).rejects.toMatchObject({ name: "AbortError" });
  });
});
