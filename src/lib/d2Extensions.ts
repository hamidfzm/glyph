// D2 (https://d2lang.com) is a declarative diagram language. Like notebooks and
// canvas, a `.d2` file is a separate document type from markdown, so its
// extension lives here as a fixed constant rather than in tauri.conf.json's
// markdown `fileAssociations[0]` list. Unlike notebooks/canvas it IS registered
// as its own OS file association (a second `fileAssociations` entry) so the OS
// can open `.d2` files with Glyph.
//
// A `.d2` file's whole body is diagram source. We fence-wrap it as a ```d2
// block so it flows through the existing markdown render path — mirroring the
// `.mmd` → Mermaid adapter in `mmd.ts` — where `CodeBlockComponent` turns it
// into a `D2Diagram`.

export const D2_EXTENSIONS: readonly string[] = ["d2"];

export function isD2File(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? D2_EXTENSIONS.includes(ext) : false;
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
