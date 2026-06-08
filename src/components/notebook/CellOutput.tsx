import type { NotebookOutput } from "@/lib/notebook/types";
import { AnsiText } from "./AnsiText";
import { DataOutputView } from "./DataOutputView";

interface CellOutputProps {
  output: NotebookOutput;
  filePath?: string;
}

export function CellOutput({ output, filePath }: CellOutputProps) {
  if (output.kind === "stream") {
    return (
      <AnsiText
        className={`nb-output-text${output.name === "stderr" ? " nb-output-stderr" : ""}`}
        text={output.text}
      />
    );
  }
  if (output.kind === "error") {
    const text =
      output.traceback.length > 0
        ? output.traceback.join("\n")
        : `${output.ename}: ${output.evalue}`;
    return <AnsiText className="nb-output-text nb-output-error" text={text} />;
  }
  return <DataOutputView output={output} filePath={filePath} />;
}
