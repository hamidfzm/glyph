// A `.d2` file's whole body is diagram source. We fence-wrap it as a ```d2
// block so it flows through the existing markdown render path, mirroring the
// `.mmd` to Mermaid adapter in `mmd.ts`, where `CodeBlockComponent` turns it
// into a `D2Diagram`.

import { D2_EXTENSIONS, hasExtension } from "./extensionConfig";

export { D2_EXTENSIONS };

export function isD2File(path: string): boolean {
  return hasExtension(path, D2_EXTENSIONS);
}

/**
 * Wrap a `.d2` file body in a `d2` fence so the markdown renderer turns it into
 * a diagram. Non-`.d2` paths are returned unchanged. The body is not escaped:
 * D2 source does not use ``` fences, so this matches `wrapAsMermaid`'s approach.
 */
export function adaptD2Content(path: string, content: string): string {
  if (!isD2File(path)) return content;
  return ["```d2", content.replace(/\s+$/u, ""), "```", ""].join("\n");
}
