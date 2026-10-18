// Line-oriented reading of a streamed chat response. SSE (Claude, OpenAI) and
// NDJSON (Ollama) are both line-delimited, so they share the reader.

/** A reply the renderer keeps in memory; the Ollama host is user-chosen. */
export const MAX_STREAM_BYTES = 16 * 1024 * 1024;
/** One event line; the parsers below never need more. */
export const MAX_LINE_BYTES = 1024 * 1024;
/** How much of an error body is worth reading into the message. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * Read a fetch response body as UTF-8 text lines (SSE and NDJSON are both
 * line-oriented). Falls back to splitting the full body when the environment
 * exposes no readable stream. Stops, with an error, at the size caps: a host
 * the user configured can otherwise grow the renderer's memory without end.
 */
export async function streamLines(
  response: Response,
  onLine: (line: string) => void,
): Promise<void> {
  const body = response.body;
  if (!body) {
    for (const line of (await response.text()).split("\n")) onLine(line);
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    if (received > MAX_STREAM_BYTES || buffer.length > MAX_LINE_BYTES) {
      await reader.cancel();
      throw new Error("response exceeds the size limit");
    }
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      onLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) onLine(buffer);
}

/** The start of an error response's body, for the error message. */
export async function errorBody(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    return (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < MAX_ERROR_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text.slice(0, MAX_ERROR_BODY_BYTES);
}

/** Extract the JSON payload of an SSE `data:` line, or null for other lines. */
export function sseData(line: string): unknown | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
