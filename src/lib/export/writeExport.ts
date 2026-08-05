import { invoke } from "@tauri-apps/api/core";

export type ExportFormat = "html" | "docx" | "epub" | "pdf";

// File extension per format. The save-dialog filter *name* is translated at
// call time (see `exportFilter.<format>` in common.json).
export const EXPORT_EXT: Record<ExportFormat, string> = {
  html: "html",
  docx: "docx",
  epub: "epub",
  pdf: "pdf",
};

// Write binary export output via the Rust command. The bytes are sent as a
// plain number array: `@tauri-apps/api`'s `invoke` JSON-serializes arguments,
// and a nested `Uint8Array` would become an object (`{"0":..}`) that Rust's
// `Vec<u8>` can't deserialize — so DOCX/EPUB/PDF must be converted first.
export function writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  return invoke("write_binary_file", { path, contents: Array.from(bytes) });
}

/** EPUB requires a unique identifier and a modified timestamp per build. */
export function epubMetadata(title: string, author?: string) {
  return {
    title,
    author,
    language: "en",
    identifier: crypto.randomUUID(),
    modified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}
