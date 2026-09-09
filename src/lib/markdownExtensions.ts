import { hasExtension, MARKDOWN_EXTENSIONS } from "./extensionConfig";

export { MARKDOWN_EXTENSIONS };

export function isMarkdownFile(path: string): boolean {
  return hasExtension(path, MARKDOWN_EXTENSIONS);
}
