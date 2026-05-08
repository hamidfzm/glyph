// Toggle a single GFM task-list item in markdown source by line number.
// We rewrite source rather than the rendered AST so the user's existing
// formatting (indent, bullet style, line endings) is preserved exactly.
const TASK_LINE = /^(\s*[-*+]\s+)\[([ xX])\](\s)/;

export function toggleTaskAtLine(source: string, line: number): string {
  if (line < 1) return source;
  // Track line endings so we don't normalise CRLF → LF on a save.
  const eolMatch = source.match(/\r\n|\r|\n/);
  const eol = eolMatch ? eolMatch[0] : "\n";
  const lines = source.split(/\r\n|\r|\n/);
  if (line > lines.length) return source;

  const idx = line - 1;
  const original = lines[idx];
  const replaced = original.replace(
    TASK_LINE,
    (_, prefix: string, mark: string, trailing: string) => {
      const next = mark === " " ? "x" : " ";
      return `${prefix}[${next}]${trailing}`;
    },
  );
  if (replaced === original) return source;
  lines[idx] = replaced;
  return lines.join(eol);
}
