import { adaptMmdContent } from "@/lib/mmd";
import type { PreviewMessage } from "@/preview/startPreview";
// biome-ignore lint/style/noRestrictedImports: lives outside src/, but it is the canonical config
import previewConfig from "../../src-tauri/preview.json";

/** The cap the Windows and Quick Look previews apply too: all three read preview.json. */
export const MAX_DOCUMENT_BYTES = previewConfig.maxDocumentBytes;

/** Strict UTF-8, as the OS previews require; a leading BOM is dropped. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

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
