import { D2_EXTENSIONS, hasExtension, USER_FILE_EXTENSIONS } from "@/lib/extensionConfig";
import type { Disposer } from "./disposer";
import { createRegistry } from "./registry";
import type { FileTypeContribution } from "./types";

// Module-level, like the dictionary sources: the open gate and the document
// pipeline are plain modules with no route to the plugins context.
export const fileTypes = createRegistry<FileTypeContribution>();

// Markdown, notebooks, canvases, images, and media have their own viewers; a
// plugin claiming one would turn every such file into a read-only code block.
// `.d2` is the exception: it is a plugin-rendered type the app only associates.
const BUILT_IN_EXTENSIONS = new Set(
  USER_FILE_EXTENSIONS.filter((ext) => !D2_EXTENSIONS.includes(ext)),
);

// The language becomes a fence info string, so anything beyond a plain word
// (a newline, a backtick) would let a plugin inject markdown around the file.
const LANGUAGE = /^[\w.+-]+$/;
const EXTENSION = /^[a-z0-9]+$/;

/**
 * Add a plugin file type; extensions are matched without the dot, ignoring
 * case. Throws on a malformed contribution or a built-in extension.
 */
export function registerFileType({ extensions, language }: FileTypeContribution): Disposer {
  if (typeof language !== "string" || !LANGUAGE.test(language)) {
    throw new Error(`file type language must be a plain word, got ${JSON.stringify(language)}`);
  }
  if (!Array.isArray(extensions) || extensions.length === 0) {
    throw new Error("file type extensions must be a non-empty array");
  }
  const normalized = extensions.map((ext) => String(ext).replace(/^\./, "").toLowerCase());
  for (const ext of normalized) {
    if (!EXTENSION.test(ext)) throw new Error(`invalid file type extension "${ext}"`);
    if (BUILT_IN_EXTENSIONS.has(ext)) {
      throw new Error(`".${ext}" files are built in and cannot be claimed by a plugin`);
    }
  }
  return fileTypes.register({ extensions: normalized, language });
}

/** The file type registered for `path`; the earliest registration wins. */
export function fileTypeFor(
  path: string,
  registered: readonly FileTypeContribution[] = fileTypes.list(),
): FileTypeContribution | undefined {
  return registered.find((type) => hasExtension(path, type.extensions));
}
