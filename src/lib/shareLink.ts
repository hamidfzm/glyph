import { encodeDocument, MAX_LINK_LENGTH } from "@/lib/linkCodec";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import type { FileState } from "@/lib/tabs";

/** Glyph's web viewer, which glyph-md/view deploys under package.json's homepage. */
export const WEB_VIEWER_URL = new URL("view/", `${__HOMEPAGE__}/`).href;

/** A loaded markdown file, or an untitled document, which is always markdown. */
export function canShareLink(file: FileState | null | undefined): file is FileState {
  if (!file || file.content === null) return false;
  return file.virtual || isMarkdownFile(file.path);
}

/** A viewer link that carries `content`, or null when it would be too long to open. */
export async function shareLinkFor(content: string): Promise<string | null> {
  const link = `${WEB_VIEWER_URL}#${await encodeDocument(content)}`;
  return link.length > MAX_LINK_LENGTH ? null : link;
}
