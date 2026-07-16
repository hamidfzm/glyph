import { invoke } from "@tauri-apps/api/core";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { deriveExportMeta } from "@/lib/export/meta";
import { prepareContent } from "@/lib/export/prepareContent";
import { pickSave } from "@/lib/pickers";
import type { ExporterContribution } from "./types";

export interface RunExporterOptions {
  exporter: ExporterContribution;
  entries: TocEntry[];
  filePath?: string;
  content: string | null;
}

/**
 * The shared pipeline behind plugin-contributed export formats: clone the
 * rendered document, ask for a destination, let the plugin build the bytes,
 * write the file. Mirrors useExport's flow so a plugin exporter behaves like
 * a built-in one. No-ops when nothing is rendered or the user cancels.
 */
export async function runExporter({
  exporter,
  entries,
  filePath,
  content,
}: RunExporterOptions): Promise<void> {
  const prepared = await prepareContent({ entries, includeToc: false });
  if (prepared == null) return; // nothing rendered to export

  const meta = deriveExportMeta(filePath, content);
  const path = await pickSave(`${meta.baseName}.${exporter.extension}`, exporter.label, [
    exporter.extension,
  ]);
  if (!path) return; // user cancelled

  const output = await exporter.build(prepared.html);
  if (typeof output === "string") {
    await invoke("write_file", { path, content: output });
  } else {
    await invoke("write_binary_file", { path, contents: Array.from(output) });
  }
}
