import { hasExtension } from "@/lib/extensionConfig";
import type { Disposer } from "./disposer";
import { createRegistry } from "./registry";
import type { FileTypeContribution } from "./types";

// Module-level, like the dictionary sources: the open gate and the document
// pipeline are plain modules with no route to the plugins context.
export const fileTypes = createRegistry<FileTypeContribution>();

/** Add a plugin file type; extensions are matched without the dot, ignoring case. */
export function registerFileType({ extensions, language }: FileTypeContribution): Disposer {
  return fileTypes.register({
    extensions: extensions.map((ext) => ext.replace(/^\./, "").toLowerCase()),
    language,
  });
}

/** The file type registered for `path`; the earliest registration wins. */
export function fileTypeFor(path: string): FileTypeContribution | undefined {
  return fileTypes.list().find((type) => hasExtension(path, type.extensions));
}
