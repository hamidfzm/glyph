import { isImageFile } from "@/lib/imageExtensions";
import { decodeHref } from "@/lib/relativePath";
import type { PickedImages } from "@/preview/previewImages";

export interface FolderImages {
  /** A `blob:` URL for the image a relative `src` names in the folder, made on first use. */
  url: PickedImages;
  /** Revokes every URL handed out; later lookups find nothing. */
  revoke(): void;
}

/** The image files of a folder the reader picked, by their path inside it. */
export function pickFolderImages(files: Iterable<File>): FolderImages {
  const images = new Map<string, File>();
  for (const file of files) {
    // Each path starts with the picked folder's own name.
    const path = file.webkitRelativePath.slice(file.webkitRelativePath.indexOf("/") + 1);
    if (isImageFile(path)) images.set(path, file);
  }
  const urls = new Map<File, string>();
  return {
    url(src) {
      const file = images.get(pathInFolder(src));
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

// Spelled as `webkitRelativePath` spells it: decoded, `/`-separated, with no
// query or fragment. No picked path holds `..`, so an escaping one finds nothing.
function pathInFolder(src: string): string {
  return decodeHref(src.split(/[?#]/)[0])
    .split(/[/\\]/)
    .filter((segment) => segment !== ".")
    .join("/");
}
