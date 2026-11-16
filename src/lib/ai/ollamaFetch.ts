import { invoke } from "@tauri-apps/api/core";
import { OllamaUnreachableError } from "@/lib/ai/types";
import { errorMessage } from "@/lib/errorMessage";

type OllamaEndpoint = "chat" | "tags";

interface OllamaHead {
  rid: number;
  status: number;
}

const cancel = (rid: number) => invoke<void>("ollama_cancel", { rid }).catch(() => undefined);

function send(
  baseUrl: string,
  endpoint: OllamaEndpoint,
  body: unknown,
  signal?: AbortSignal,
): Promise<OllamaHead> {
  const sent = invoke<OllamaHead>("ollama_send", { baseUrl, endpoint, body }).catch(
    (err: unknown) => {
      throw new OllamaUnreachableError(baseUrl, errorMessage(err));
    },
  );
  if (!signal) return sent;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason);
      // The status may still come: drop that reply unread.
      sent.then(
        (head) => cancel(head.rid),
        () => undefined,
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    sent.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** The reply body, read one chunk per pull; an empty chunk is its end. */
function body(rid: number, signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener(
        "abort",
        () => {
          controller.error(signal.reason);
          void cancel(rid);
        },
        { once: true },
      );
    },
    async pull(controller) {
      const chunk = new Uint8Array(await invoke<ArrayBuffer>("ollama_read", { rid }));
      if (signal?.aborted) return;
      if (chunk.byteLength > 0) controller.enqueue(chunk);
      else controller.close();
    },
    cancel: () => cancel(rid),
  });
}

/**
 * A request to the Ollama server, made by the backend: from the page it would
 * carry an origin Ollama's defaults refuse on Windows (`http://tauri.localhost`).
 * `signal` cancels it as it would a fetch. Rejects with `OllamaUnreachableError`
 * when no reply comes back.
 */
export async function ollamaFetch(
  baseUrl: string,
  endpoint: OllamaEndpoint,
  init: { body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> {
  const { signal } = init;
  if (signal?.aborted) throw signal.reason;
  const head = await send(baseUrl, endpoint, init.body ?? null, signal);
  // An abort landing as the status arrived: the body's listener would miss it.
  if (signal?.aborted) {
    void cancel(head.rid);
    throw signal.reason;
  }
  return new Response(body(head.rid, signal), { status: head.status });
}
