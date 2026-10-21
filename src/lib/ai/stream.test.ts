import { describe, expect, it } from "vitest";
import { errorBody, MAX_LINE_BYTES, MAX_STREAM_BYTES, streamLines } from "./stream";

function streaming(chunks: (string | Uint8Array)[]): Response {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        }
        controller.close();
      },
    }),
  } as unknown as Response;
}

describe("streamLines", () => {
  it("joins lines split across chunks and flushes the last one", async () => {
    const lines: string[] = [];
    await streamLines(streaming(["a\nb", "c\n", "d"]), (line) => lines.push(line));
    expect(lines).toEqual(["a", "bc", "d"]);
  });

  it("stops at the stream cap instead of buffering a reply without end", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    const chunks = Array.from({ length: MAX_STREAM_BYTES / chunk.byteLength + 1 }, () => chunk);
    let seen = 0;
    await expect(
      streamLines(streaming(chunks), () => {
        seen += 1;
      }),
    ).rejects.toThrow("exceeds the size limit");
    expect(seen).toBe(0);
  });

  it("stops at the line cap when no newline ever arrives", async () => {
    const chunks = Array.from({ length: 3 }, () => "x".repeat(MAX_LINE_BYTES / 2));
    await expect(streamLines(streaming(chunks), () => undefined)).rejects.toThrow(
      "exceeds the size limit",
    );
  });
});

describe("errorBody", () => {
  it("reads a short body whole", async () => {
    await expect(errorBody(streaming(["Unauth", "orized"]))).resolves.toBe("Unauthorized");
  });

  it("reads no more than the cap of a long body", async () => {
    const chunks = Array.from({ length: 5 }, () => "e".repeat(32 * 1024));
    const text = await errorBody(streaming(chunks));
    expect(text).toHaveLength(64 * 1024);
  });

  it("falls back to text() when the response cannot stream", async () => {
    const response = { body: null, text: () => Promise.resolve("plain") } as unknown as Response;
    await expect(errorBody(response)).resolves.toBe("plain");
  });
});
