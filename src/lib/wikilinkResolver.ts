// Resolves a `[[wikilink]]` target against a flat list of workspace markdown
// file paths. Match is case-insensitive on the filename stem; `.md` extension
// in the target is stripped. When multiple files share a stem, the file in
// the same directory as `currentFilePath` wins; otherwise the first match
// (sorted by path) is used.

const PATH_SEP = /[\\/]/;

export interface ResolvedWikilink {
  path: string | null;
  heading?: string;
}

export function splitTargetAndHeading(input: string): { target: string; heading?: string } {
  const idx = input.indexOf("#");
  if (idx < 0) return { target: input };
  const heading = input.slice(idx + 1).trim();
  return { target: input.slice(0, idx), heading: heading || undefined };
}

export function stemOf(path: string): string {
  const name = path.split(PATH_SEP).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function dirOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(0, idx) : "";
}

function normalizeTarget(raw: string): string {
  let t = raw.trim();
  if (t.toLowerCase().endsWith(".md")) t = t.slice(0, -3);
  return t;
}

export function resolveWikilink(
  rawTarget: string,
  workspaceFiles: string[],
  currentFilePath?: string,
): ResolvedWikilink {
  const { target, heading } = splitTargetAndHeading(rawTarget);
  const cleaned = normalizeTarget(target);
  if (!cleaned || workspaceFiles.length === 0) return { path: null, heading };

  const lower = cleaned.toLowerCase();

  // Two match modes:
  //  1. relative-path-ish target ("folder/note") → match the suffix of any path
  //  2. bare name → match by stem
  const looksLikePath = cleaned.includes("/") || cleaned.includes("\\");

  const candidates: string[] = [];
  for (const file of workspaceFiles) {
    if (looksLikePath) {
      const noExt = file.replace(/\.[^./\\]+$/, "");
      if (noExt.toLowerCase().endsWith(`/${lower}`) || noExt.toLowerCase().endsWith(`\\${lower}`)) {
        candidates.push(file);
      }
    } else if (stemOf(file).toLowerCase() === lower) {
      candidates.push(file);
    }
  }

  if (candidates.length === 0) return { path: null, heading };
  if (candidates.length === 1) return { path: candidates[0], heading };

  // Disambiguate: prefer same-directory as the current file.
  if (currentFilePath) {
    const currentDir = dirOf(currentFilePath);
    const sameDir = candidates.find((c) => dirOf(c) === currentDir);
    if (sameDir) return { path: sameDir, heading };
  }
  // Stable fallback: shortest path, then lexicographic.
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return { path: candidates[0], heading };
}
