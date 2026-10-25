import { encodeDocument, MAX_LINK_LENGTH } from "@/lib/linkCodec";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import { MAX_DOCUMENT_BYTES } from "@/lib/previewDocument";
import type { FileState } from "@/lib/tabs";

/** Glyph's web viewer, which glyph-md/view deploys under package.json's homepage. */
export const WEB_VIEWER_URL = new URL("view/", __HOMEPAGE__.replace(/\/*$/, "/")).href;

/** A loaded markdown file, or an untitled document, which is always markdown. */
export function canShareLink(file: FileState | null | undefined): file is FileState {
  if (!file || file.content === null) return false;
  return file.virtual || isMarkdownFile(file.path);
}

/**
 * A viewer link that carries `content`, or null when the viewer would refuse
 * it: a document over the preview cap (checked first, so a large file is never
 * encoded), or a link too long to open.
 */
export async function shareLinkFor(content: string): Promise<string | null> {
  if (new TextEncoder().encode(content).length > MAX_DOCUMENT_BYTES) return null;
  const link = `${WEB_VIEWER_URL}#${await encodeDocument(content)}`;
  return link.length > MAX_LINK_LENGTH ? null : link;
}
