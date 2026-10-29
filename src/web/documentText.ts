import { adaptMmdContent } from "@/lib/mmd";
import { decodeUtf8, MAX_DOCUMENT_BYTES } from "@/lib/previewDocument";
import type { PreviewMessage } from "@/preview/startPreview";

export async function readDocumentFile(file: File): Promise<PreviewMessage> {
  // Checked before reading, so an oversized file is never loaded at all.
  if (file.size > MAX_DOCUMENT_BYTES) return { kind: "tooLarge", bytes: file.size };
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    // A dropped folder arrives as a File whose read fails.
    return { kind: "unreadable" };
  }
  const text = decodeUtf8(new Uint8Array(buffer));
  if (text === null) return { kind: "unreadable" };
  const content = adaptMmdContent(file.name, text);
  // Fencing a Mermaid source adds a few bytes, enough to push a file at the
  // cap past what its shared link may carry.
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MAX_DOCUMENT_BYTES) return { kind: "tooLarge", bytes };
  return { kind: "document", content, baseUrl: null };
}
