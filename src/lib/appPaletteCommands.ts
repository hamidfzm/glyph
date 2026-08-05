import type { TFunction } from "i18next";
import { ActualSizeIcon } from "@/components/icons/ActualSizeIcon";
import { EditModeIcon } from "@/components/icons/EditModeIcon";
import { ExternalLinkIcon } from "@/components/icons/ExternalLinkIcon";
import { FileTextIcon } from "@/components/icons/FileTextIcon";
import { FitIcon } from "@/components/icons/FitIcon";
import { FolderIcon } from "@/components/icons/FolderIcon";
import { FolderOpenIcon } from "@/components/icons/FolderOpenIcon";
import { GraphIcon } from "@/components/icons/GraphIcon";
import { NewFolderIcon } from "@/components/icons/NewFolderIcon";
import { NewNoteIcon } from "@/components/icons/NewNoteIcon";
import { OpenIcon } from "@/components/icons/OpenIcon";
import { OutlineIcon } from "@/components/icons/OutlineIcon";
import { SparkleIcon } from "@/components/icons/SparkleIcon";
import { TabCloseIcon } from "@/components/icons/TabCloseIcon";
import { ZoomInIcon } from "@/components/icons/ZoomInIcon";
import { ZoomOutIcon } from "@/components/icons/ZoomOutIcon";
import type { AppActions } from "@/hooks/useAppCommands";
import type { Command } from "@/lib/commands";

/**
 * The app-level palette entries: the subset of menu items worth invoking from a
 * palette. The Help-menu external links (documentation, releaseNotes,
 * reportIssue on AppActions) are intentionally omitted — they belong in the
 * native Help menu only.
 */
export function appPaletteCommands(
  t: TFunction<"commands">,
  actions: AppActions,
  workspaceOpen: boolean,
): Command[] {
  const out: Command[] = [];
  out.push(
    {
      id: "cmd:newDocument",
      title: t("newDocument"),
      section: "Commands",
      icon: NewNoteIcon,
      shortcut: "Cmd/Ctrl+N",
      run: actions.newDocument,
    },
    {
      id: "cmd:openFile",
      title: t("openFile"),
      section: "Commands",
      icon: OpenIcon,
      shortcut: "Cmd/Ctrl+O",
      run: actions.openFile,
    },
    {
      id: "cmd:openFolder",
      title: t("openFolder"),
      section: "Commands",
      icon: FolderOpenIcon,
      shortcut: "Cmd/Ctrl+Shift+O",
      run: actions.openFolder,
    },
    {
      id: "cmd:newWorkspace",
      title: t("newWorkspace"),
      section: "Commands",
      icon: NewFolderIcon,
      run: actions.newWorkspace,
    },
    {
      id: "cmd:closeTab",
      title: t("closeTab"),
      section: "Commands",
      icon: TabCloseIcon,
      shortcut: "Cmd/Ctrl+W",
      run: actions.closeTab,
    },
    {
      id: "cmd:toggleFilesSidebar",
      title: t("toggleFilesSidebar"),
      section: "Commands",
      icon: FolderIcon,
      shortcut: "Cmd/Ctrl+B",
      run: actions.toggleFilesSidebar,
    },
    {
      id: "cmd:toggleOutlineSidebar",
      title: t("toggleOutlineSidebar"),
      section: "Commands",
      icon: OutlineIcon,
      shortcut: "Cmd/Ctrl+\\",
      run: actions.toggleOutlineSidebar,
    },
    {
      id: "cmd:resetView",
      title: t("resetView"),
      section: "Commands",
      icon: FitIcon,
      run: actions.resetView,
    },
    {
      id: "cmd:openSettings",
      title: t("openSettings"),
      section: "Commands",
      shortcut: "Cmd/Ctrl+,",
      run: actions.openSettings,
    },
    {
      id: "cmd:openSyncSettings",
      title: t("openSyncSettings"),
      section: "Commands",
      run: actions.openSyncSettings,
    },
    {
      id: "cmd:toggleAutoSave",
      title: t("toggleAutoSave"),
      section: "Commands",
      run: actions.toggleAutoSave,
    },
    {
      id: "cmd:find",
      title: t("find"),
      section: "Commands",
      shortcut: "Cmd/Ctrl+F",
      run: actions.find,
    },
    {
      id: "cmd:toggleEdit",
      title: t("toggleEdit"),
      section: "Commands",
      icon: EditModeIcon,
      shortcut: "Cmd/Ctrl+E",
      run: actions.toggleEdit,
    },
    {
      id: "cmd:openGraph",
      title: t("openGraph"),
      section: "Commands",
      icon: GraphIcon,
      shortcut: "Cmd/Ctrl+G",
      run: actions.openGraph,
    },
    {
      id: "cmd:print",
      title: t("print"),
      section: "Commands",
      shortcut: "Cmd/Ctrl+P",
      run: actions.print,
    },
    {
      id: "cmd:exportHtml",
      title: t("exportHtml"),
      section: "Commands",
      icon: FileTextIcon,
      run: actions.exportHtml,
    },
    {
      id: "cmd:exportDocx",
      title: t("exportDocx"),
      section: "Commands",
      icon: FileTextIcon,
      run: actions.exportDocx,
    },
    {
      id: "cmd:exportEpub",
      title: t("exportEpub"),
      section: "Commands",
      icon: FileTextIcon,
      run: actions.exportEpub,
    },
    {
      id: "cmd:exportPdf",
      title: t("exportPdf"),
      section: "Commands",
      icon: FileTextIcon,
      run: actions.exportPdf,
    },
  );

  // Workspace-wide export; pointless (and menu-disabled) without a folder.
  if (workspaceOpen) {
    out.push(
      {
        id: "cmd:exportWebsite",
        title: t("exportWebsite"),
        section: "Commands",
        icon: ExternalLinkIcon,
        run: actions.exportWebsite,
      },
      {
        id: "cmd:workspaceSettings",
        title: t("workspaceSettings"),
        section: "Commands",
        run: actions.workspaceSettings,
      },
    );
  }

  out.push(
    {
      id: "cmd:zoomIn",
      title: t("zoomIn"),
      section: "Commands",
      icon: ZoomInIcon,
      shortcut: "Cmd/Ctrl+=",
      run: actions.zoomIn,
    },
    {
      id: "cmd:zoomOut",
      title: t("zoomOut"),
      section: "Commands",
      icon: ZoomOutIcon,
      shortcut: "Cmd/Ctrl+-",
      run: actions.zoomOut,
    },
    {
      id: "cmd:zoomReset",
      title: t("zoomReset"),
      section: "Commands",
      icon: ActualSizeIcon,
      shortcut: "Cmd/Ctrl+0",
      run: actions.zoomReset,
    },
    {
      id: "cmd:aiChat",
      title: t("aiChat"),
      section: "Commands",
      icon: SparkleIcon,
      shortcut: "Cmd/Ctrl+Shift+A",
      run: actions.aiChat,
    },
    { id: "cmd:readAloud", title: t("readAloud"), section: "Commands", run: actions.readAloud },
    {
      id: "cmd:managePlugins",
      title: t("managePlugins"),
      section: "Commands",
      run: actions.managePlugins,
    },
  );
  return out;
}
