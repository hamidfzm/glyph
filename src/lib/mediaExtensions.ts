// Video and audio assets referenced from markdown. Like images, these are not
// documents Glyph edits: the set is fixed here rather than derived from
// tauri.conf.json fileAssociations, and stays out of `isSupportedFile` so the
// graph and wikilink autocomplete ignore them. Unlike images they are also kept
// out of the file tree, since Glyph has no media viewer tab.

export const VIDEO_EXTENSIONS: readonly string[] = ["mp4", "webm", "ogv", "mov", "m4v"];

export const AUDIO_EXTENSIONS: readonly string[] = [
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "oga",
  "opus",
  "flac",
];

// EPUB manifest items need a media type per packaged file. `mov` and `m4v` are
// QuickTime containers the OS webviews play but that have no registered MIME of
// their own; video/mp4 is what readers expect for them.
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

function extensionOf(path: string): string {
  return path.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
}

export function isVideoFile(path: string): boolean {
  return VIDEO_EXTENSIONS.includes(extensionOf(path));
}

export function isAudioFile(path: string): boolean {
  return AUDIO_EXTENSIONS.includes(extensionOf(path));
}

export function isMediaFile(path: string): boolean {
  return isVideoFile(path) || isAudioFile(path);
}

/** Media type for a packaged file, or undefined for an unknown extension. */
export function mediaMimeType(path: string): string | undefined {
  return MEDIA_MIME_TYPES[extensionOf(path)];
}
