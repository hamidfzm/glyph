import { isImageFile } from "@/lib/imageExtensions";
import { decodeHref } from "@/lib/relativePath";
import type { PickedImages } from "@/preview/previewImages";

export interface FolderImages {
  /** A `blob:` URL for the image a relative `src` names beside the document, made on first use. */
  url: PickedImages;
  /** Revokes every URL handed out; later lookups find nothing. */
  revoke(): void;
}

/**
 * The image files of a folder the reader picked. A relative `src` resolves from
 * where `opened`, the file the document came from, sits in that folder.
 */
export function pickFolderImages(files: File[], opened: File | null): FolderImages {
  const documentFolder = findDocumentFolder(files, opened);
  const images = new Map<string, File>();
  for (const file of files) {
    const path = pickedPath(file);
    if (isImageFile(path)) images.set(path, file);
  }
  const urls = new Map<File, string>();
  return {
    url(src) {
      const file = images.get(documentFolder + pathInFolder(src));
      if (!file) return null;
      let url = urls.get(file);
      if (!url) {
        url = URL.createObjectURL(file);
        urls.set(file, url);
      }
      return url;
    },
    revoke() {
      images.clear();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

// A browser gives a page no paths, so the document is recognised by its name,
// size and time. A shared link has no file to find, and an edited copy no
// match: their images resolve from the top of the picked folder.
function findDocumentFolder(files: File[], opened: File | null): string {
  if (!opened) return "";
  const copies = files
    .filter(
      (file) =>
        file.name === opened.name &&
        file.size === opened.size &&
        file.lastModified === opened.lastModified,
    )
    .map(pickedPath)
    .sort((a, b) => a.split("/").length - b.split("/").length);
  const shallowest = copies[0] ?? "";
  return shallowest.slice(0, shallowest.lastIndexOf("/") + 1);
}

// Each `webkitRelativePath` starts with the picked folder's own name.
function pickedPath(file: File): string {
  return file.webkitRelativePath.slice(file.webkitRelativePath.indexOf("/") + 1);
}

// Spelled as `webkitRelativePath` spells it: decoded, `/`-separated, with no
// query or fragment. No picked path holds `..`, so an escaping one finds nothing.
function pathInFolder(src: string): string {
  return decodeHref(src.split(/[?#]/)[0])
    .split(/[/\\]/)
    .filter((segment) => segment !== ".")
    .join("/");
}
