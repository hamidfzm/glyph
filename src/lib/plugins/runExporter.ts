import { invoke } from "@tauri-apps/api/core";
import type { TocEntry } from "@/hooks/useTableOfContents";
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
  // Loaded on first use so the export pipeline stays out of the startup bundle.
  const [
    { prepareContent },
    { deriveExportMeta },
    { EXPORTABLE_ROOT_SELECTOR, waitForRenderIdle },
  ] = await Promise.all([
    import("@/lib/export/prepareContent"),
    import("@/lib/export/meta"),
    import("@/lib/export/renderReady"),
  ]);

  // The plugin gets the same fully-rendered DOM the built-in exporters do.
  // Skipped when nothing is rendered: `prepareContent` bails just below, and
  // waiting would stall until the gate's deadline first.
  if (document.querySelector(EXPORTABLE_ROOT_SELECTOR)) await waitForRenderIdle();
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
