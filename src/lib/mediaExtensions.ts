import { basename } from "@/lib/paths";

// Media types for the files an EPUB export packages, the one container that can
// carry them. `mov` and `m4v` are QuickTime containers the OS webviews play but
// that have no registered media type of their own; readers expect video/mp4.
// The viewer itself needs no extension list: it plays whatever the webview can.
const MEDIA_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
};

/** Media type for a packaged file, or undefined for one we cannot declare. */
export function mediaMimeType(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  // Own keys only: a plain-object lookup also resolves `constructor` and
  // `__proto__`, so a file named `clip.constructor` would hand the EPUB
  // manifest a function to escape.
  return Object.hasOwn(MEDIA_MIME_TYPES, ext) ? MEDIA_MIME_TYPES[ext] : undefined;
}

/**
 * How a media file is named wherever it cannot be played: on paper, and in
 * every export but the website one. A local file is named, since neither the
 * page nor the exported document carries it; a remote one keeps its full URL,
 * the only form of it that still leads anywhere.
 */
export function mediaLabel(localPath: string | undefined, remoteSrc: string | undefined): string {
  if (localPath) return basename(localPath);
  return remoteSrc ?? "";
}
