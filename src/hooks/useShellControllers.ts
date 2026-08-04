import { useTabsContext } from "@/contexts/TabsContext";
import { useZoomApi } from "@/contexts/ZoomContext";
import { useAIController } from "@/hooks/useAIController";
import { useExport } from "@/hooks/useExport";
import { useExportSite } from "@/hooks/useExportSite";
import { usePluginExporterRunner } from "@/hooks/usePluginExporterRunner";
import { usePrint } from "@/hooks/usePrint";
import { useReadAloudController } from "@/hooks/useReadAloudController";
import { useSettings } from "@/hooks/useSettings";
import { aiDocContext } from "@/lib/aiPrompts";

/**
 * The document-surface controllers the shell owns: AI chat, read-aloud, print,
 * the export formats, workspace website export, zoom, and the plugin exporter
 * runner. Each is driven by the active document, so they are built together.
 */
export function useShellControllers() {
  const { settings } = useSettings();
  const { activeFile, displayContent, workspace, workspaceFiles, tocEntries } = useTabsContext();

  const aiController = useAIController(
    settings.ai,
    aiDocContext({
      path: activeFile?.path,
      content: displayContent,
      workspaceRoot: workspace?.root,
      workspaceFiles,
    }),
  );
  const readAloud = useReadAloudController(settings.ai, () => displayContent);
  const printDoc = usePrint({ entries: tocEntries, settings: settings.print });
  const exporters = useExport({
    entries: tocEntries,
    settings: settings.print,
    filePath: activeFile?.path,
    content: displayContent,
  });
  const siteExporter = useExportSite(workspace?.root);
  // Zoom In/Out/Actual-Size dispatch to whichever document surface is active
  // (note font, graph camera) via the ZoomProvider; no-op with nothing focused.
  const zoomActions = useZoomApi()?.actions;
  const runPluginExporter = usePluginExporterRunner({
    entries: tocEntries,
    filePath: activeFile?.path,
    content: displayContent,
  });

  return {
    aiController,
    readAloud,
    tts: readAloud.tts,
    printDoc,
    exporters,
    siteExporter,
    zoomActions,
    runPluginExporter,
  };
}

export type ShellControllers = ReturnType<typeof useShellControllers>;
