import { invoke } from "@tauri-apps/api/core";
import { collectStyles } from "@/lib/export/collectStyles";
import { pickSave } from "@/lib/pickers";
import { prepareRenderedHtml } from "./renderedHtml";
import type { ExporterContribution } from "./types";

export interface RunExporterOptions {
  exporter: ExporterContribution;
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
  filePath,
  content,
}: RunExporterOptions): Promise<void> {
  const html = await prepareRenderedHtml();
  if (html == null) return; // nothing rendered to export

  const { deriveExportMeta } = await import("@/lib/export/meta");
  const meta = deriveExportMeta(filePath, content);
  const path = await pickSave(`${meta.baseName}.${exporter.extension}`, exporter.label, [
    exporter.extension,
  ]);
  if (!path) return; // user cancelled

  const output = await exporter.build(html, {
    title: meta.title,
    css: collectStyles(),
    dark: document.documentElement.classList.contains("dark"),
  });
  if (typeof output === "string") {
    await invoke("write_file", { path, content: output });
  } else {
    await invoke("write_binary_file", { path, contents: Array.from(output) });
  }
}
