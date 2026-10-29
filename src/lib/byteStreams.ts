// Feeding bytes through a (de)compression stream and reading back what comes
// out, with a cap for untrusted input.

// Small input chunks let the reader cancel a decompression bomb before a browser
// inflates much past the cap: one 4 KiB chunk expands to at most about 4 MiB.
const INPUT_CHUNK_BYTES = 4096;

export function chunked(bytes: Uint8Array): ReadableStream<BufferSource> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + INPUT_CHUNK_BYTES));
      offset += INPUT_CHUNK_BYTES;
    },
  });
}

/** Every byte the stream yields; throws, and stops reading, once there are more than `limit`. */
export async function collect(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new RangeError("over the size cap");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
