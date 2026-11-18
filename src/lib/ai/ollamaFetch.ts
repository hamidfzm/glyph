import { invoke } from "@tauri-apps/api/core";
import { OllamaUnreachableError, OllamaUrlError } from "@/lib/ai/types";
import { errorMessage } from "@/lib/errorMessage";

type OllamaEndpoint = "chat" | "tags";

const cancel = (rid: number) => invoke<void>("ollama_cancel", { rid }).catch(() => undefined);

/** The reply body, read one chunk per pull; an empty chunk is its end. */
function body(rid: number, signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      let chunk: Uint8Array;
      try {
        chunk = new Uint8Array(await invoke<ArrayBuffer>("ollama_read", { rid }));
      } catch (err) {
        // A read the abort cancelled fails in the backend; the abort is the cause.
        throw signal?.aborted ? signal.reason : err;
      }
      if (chunk.byteLength > 0) controller.enqueue(chunk);
      else controller.close();
    },
    cancel: () => cancel(rid),
  });
}

/**
 * A request to the Ollama server, made by the backend: from the page it would
 * carry an origin Ollama's defaults refuse on Windows (`http://tauri.localhost`).
 * `signal` cancels it as it would a fetch, closing the connection. Rejects with
 * `OllamaUrlError` for a refused URL and `OllamaUnreachableError` when no reply comes.
 */
export async function ollamaFetch(
  baseUrl: string,
  endpoint: OllamaEndpoint,
  init: { body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> {
  const { signal } = init;
  if (signal?.aborted) throw signal.reason;
  const rid = await invoke<number>("ollama_open", {
    baseUrl,
    endpoint,
    body: init.body ?? null,
  }).catch(() => {
    throw new OllamaUrlError(baseUrl);
  });
  if (signal?.aborted) {
    void cancel(rid);
    throw signal.reason;
  }
  signal?.addEventListener("abort", () => void cancel(rid), { once: true });

  let status: number;
  try {
    status = await invoke<number>("ollama_send", { rid });
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new OllamaUnreachableError(baseUrl, errorMessage(err));
  }
  if (signal?.aborted) throw signal.reason;
  return new Response(body(rid, signal), { status });
}
