// CodeMirror completion source for wikilinks. Triggers when the cursor sits
// inside an unclosed `[[...` on the current line; suggests workspace files,
// filtered by what the user has typed since the opening brackets, and
// inserts `[[<stem>]]` (or just `<stem>]]` if the brackets exist already).
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { stemOf } from "./wikilinkResolver";

const PATH_SEP = /[\\/]/;

interface WikilinkOpening {
  /** Document offset of the first `[` in the opening `[[`. */
  start: number;
  /** Text typed between the opening `[[` and the cursor. */
  typed: string;
}

function relativeName(path: string, root?: string): string {
  if (root && (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))) {
    return path.slice(root.length + 1);
  }
  return path.split(PATH_SEP).pop() ?? path;
}

// Look back from `pos` for an unclosed `[[` on the same line. Returns null if
// the user is not currently inside a wikilink.
export function findWikilinkOpening(state: EditorState, pos: number): WikilinkOpening | null {
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const open = before.lastIndexOf("[[");
  if (open < 0) return null;

  const between = before.slice(open + 2);
  // Bail if we already crossed a closing `]]`, a newline, or a pipe-after-target
  // that puts us past the file-name portion of the link. (We only complete
  // the target itself, not aliases or headings.)
  if (between.includes("]]") || between.includes("\n")) return null;
  if (between.includes("|") || between.includes("#")) return null;

  return { start: line.from + open, typed: between };
}

export function buildWikilinkCompletions(
  workspaceFiles: readonly string[],
  workspaceRoot: string | undefined,
  typed: string,
): Completion[] {
  const lower = typed.toLowerCase();
  const out: Completion[] = [];
  const seen = new Set<string>();

  for (const file of workspaceFiles) {
    const stem = stemOf(file);
    const stemLower = stem.toLowerCase();
    const rel = relativeName(file, workspaceRoot);

    // Match by stem prefix or any token-start within the relative path —
    // matches Obsidian's behaviour where `coo` finds `Cooking.md` but also
    // `notes/cooking-tips.md`.
    const matches =
      lower.length === 0 || stemLower.startsWith(lower) || rel.toLowerCase().includes(lower);
    if (!matches) continue;

    // Dedupe by stem when multiple files share one — the second copy gets the
    // disambiguating relative path as its detail string.
    const key = seen.has(stem) ? rel : stem;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label: stem,
      detail: rel === stem ? undefined : rel,
      type: "file",
      apply: stem,
    });
  }

  // Stable order: stems that prefix-match come first, then alphabetical.
  out.sort((a, b) => {
    const aStarts = a.label.toLowerCase().startsWith(lower);
    const bStarts = b.label.toLowerCase().startsWith(lower);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return out;
}

interface CompletionOptions {
  workspaceFiles: readonly string[];
  workspaceRoot?: string;
}

// Build a CodeMirror CompletionSource from the current workspace snapshot.
export function wikilinkCompletionSource({ workspaceFiles, workspaceRoot }: CompletionOptions) {
  return (context: CompletionContext): CompletionResult | null => {
    if (workspaceFiles.length === 0) return null;
    const opening = findWikilinkOpening(context.state, context.pos);
    if (!opening) return null;
    if (!context.explicit && opening.typed.length === 0) {
      // Don't pop on a bare `[[` — wait until the user types or asks for it.
      return null;
    }

    const completions = buildWikilinkCompletions(workspaceFiles, workspaceRoot, opening.typed);
    if (completions.length === 0) return null;

    // The completion replaces what the user has typed *and* any closing `]]`
    // immediately following the cursor — so accepting "Cooking" turns
    // `[[Co|]]` into `[[Cooking]]` instead of `[[Cooking]]]]`.
    const after = context.state.sliceDoc(
      context.pos,
      Math.min(context.pos + 2, context.state.doc.length),
    );
    const closingPresent = after.startsWith("]]");
    const fromOffset = opening.start + 2;
    const toOffset = context.pos + (closingPresent ? 2 : 0);

    return {
      from: fromOffset,
      to: toOffset,
      filter: false,
      options: completions.map((c) => ({
        ...c,
        apply: `${c.apply}]]`,
      })),
    };
  };
}
