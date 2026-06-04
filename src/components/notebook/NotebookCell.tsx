import { fenceCode } from "@/lib/notebook/fence";
import type { NotebookCell as Cell, NotebookOutput } from "@/lib/notebook/types";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { CellOutput } from "./CellOutput";

/**
 * Build a stable, unique React key for an output from its content plus an
 * occurrence counter, so repeated identical outputs (e.g. two stdout streams)
 * still get distinct keys without using the array index.
 */
function makeOutputKeyer() {
  const seen = new Map<string, number>();
  return (output: NotebookOutput): string => {
    const base =
      output.kind === "stream"
        ? `stream:${output.name}`
        : output.kind === "error"
          ? `error:${output.ename}`
          : `data:${Object.keys(output.data).sort().join(",")}`;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    return `${base}#${ordinal}`;
  };
}

function promptLabel(prefix: string, count: number | null): string {
  return `${prefix} [${count ?? " "}]:`;
}

interface NotebookCellProps {
  cell: Cell;
  language: string;
  filePath?: string;
}

export function NotebookCell({ cell, language, filePath }: NotebookCellProps) {
  if (cell.type === "markdown") {
    return (
      <div className="nb-cell nb-cell-markdown markdown-body">
        <MarkdownContent content={cell.source} filePath={filePath} showFrontmatter={false} />
      </div>
    );
  }

  if (cell.type === "raw") {
    return (
      <div className="nb-cell nb-cell-raw">
        <pre className="nb-raw">{cell.source}</pre>
      </div>
    );
  }

  // Code cell: input row with `In [n]:` prompt, then one row per output.
  const outputKey = makeOutputKeyer();
  return (
    <div className="nb-cell nb-cell-code">
      <div className="nb-row">
        <div className="nb-prompt nb-prompt-in">{promptLabel("In", cell.executionCount)}</div>
        <div className="nb-row-body markdown-body nb-code-source">
          <MarkdownContent content={fenceCode(cell.source, language)} showFrontmatter={false} />
        </div>
      </div>
      {cell.outputs.map((output) => {
        const outCount = output.kind === "data" ? output.executionCount : null;
        return (
          <div className="nb-row nb-output-row" key={outputKey(output)}>
            <div className="nb-prompt nb-prompt-out">
              {outCount != null ? promptLabel("Out", outCount) : ""}
            </div>
            <div className="nb-row-body">
              <CellOutput output={output} filePath={filePath} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
