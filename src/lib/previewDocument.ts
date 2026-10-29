import previewConfig from "../../src-tauri/preview.json";

/** The web viewer's document cap, shared with the Windows and Quick Look previews through preview.json. */
export const MAX_DOCUMENT_BYTES = previewConfig.maxDocumentBytes;

/** Strict UTF-8, as the OS previews require; a leading BOM is dropped. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
