import { invoke } from "@tauri-apps/api/core";

// Asset-protocol grants last the session, so a mirrored path is never asked for
// twice. Refusals are not remembered: an image saved after the document first
// referenced it must load on the next render.
const mirrored = new Set<string>();
// One request per path, however many elements wait on it. The export gate
// counts these: an image still waiting has no src to snapshot.
const inFlight = new Map<string, Promise<void>>();

export function isDocumentAssetMirrored(path: string): boolean {
  return mirrored.has(path);
}

/** Have the backend serve a media file beside the open loose file; rejects when refused. */
export function mirrorDocumentAsset(path: string): Promise<void> {
  const existing = inFlight.get(path);
  if (existing) return existing;
  const request = invoke("allow_document_asset", { path })
    .then(() => {
      mirrored.add(path);
    })
    .finally(() => {
      inFlight.delete(path);
    });
  inFlight.set(path, request);
  return request;
}

export function pendingDocumentAssets(): number {
  return inFlight.size;
}
