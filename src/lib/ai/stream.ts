// Line-oriented reading of a streamed chat response. SSE (Claude, OpenAI) and
// NDJSON (Ollama) are both line-delimited, so they share the reader.

/**
 * Read a fetch response body as UTF-8 text lines (SSE and NDJSON are both
 * line-oriented). Falls back to splitting the full body when the environment
 * exposes no readable stream.
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
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
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
