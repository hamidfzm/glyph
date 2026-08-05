import { invoke } from "@tauri-apps/api/core";
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { D2_EXTENSIONS, isD2File } from "@/lib/d2Extensions";
import { loadFileContent } from "@/lib/documentContent";
import { isImageFile } from "@/lib/imageExtensions";
import { MARKDOWN_EXTENSIONS } from "@/lib/markdownExtensions";
import { isNotebookFile, isSupportedFile, NOTEBOOK_EXTENSIONS } from "@/lib/notebookExtensions";
import { isPathInside } from "@/lib/paths";
import { pickFiles } from "@/lib/pickers";
import { isMobilePlatform } from "@/lib/platform";
import { EDITOR_MODE, type EditorMode } from "@/lib/settings";
import { generateTabId, nextUntitledTitle } from "@/lib/tabIds";
import {
  type FileMetadata,
  type FileTab,
  type GraphTab,
  makeFileState,
  type TabsState,
  type Workspace,
} from "@/lib/tabs";
import { setWorkspaceLastFile } from "@/lib/workspace";

interface UseOpenDocumentOptions {
  stateRef: RefObject<TabsState>;
  setState: Dispatch<SetStateAction<TabsState>>;
  workspaceRef: RefObject<Workspace | null>;
  addToRecent: (path: string) => void;
  getDefaultEditorMode: () => EditorMode;
}

/** Everything that puts a new tab on the strip: files, blank buffers, the graph. */
export function useOpenDocument({
  stateRef,
  setState,
  workspaceRef,
  addToRecent,
  getDefaultEditorMode,
}: UseOpenDocumentOptions) {
  const { t } = useTranslation("workspace");

  // Open a file as a document tab; if it's already open, activate its tab.
  const openFile = useCallback(
    async (path: string) => {
      // Defensive gate: never load an unsupported file. Glyph rendering treats
      // content as markdown (HTML included via the sanitizer), so opening a
      // random `.txt` / `.html` / etc. is a code-injection vector. Notebooks
      // (`.ipynb`) are allowed — they take the dedicated NotebookViewer path.
      // Images/SVGs are allowed too — they render in the read-only image
      // viewer, never as text. See memory/reject-unsupported-file-types.md.
      // Android's document picker returns opaque `content://` URIs with no file
      // extension, so the extension-based check below can't classify them. The
      // picker's own type filters already restricted selection to supported
      // files, so trust them here. (iOS returns `file://` URLs that keep the
      // extension and take the normal path.)
      const isAndroidContentUri = path.startsWith("content://");
      if (!isAndroidContentUri && !isSupportedFile(path) && !isImageFile(path)) {
        console.warn(`Refusing to open unsupported file: ${path}`);
        return;
      }
      const existing = stateRef.current.tabs.find(
        (tab) => tab.kind === "file" && tab.file.path === path,
      );
      if (existing) {
        setState((prev) => ({ ...prev, activeTabId: existing.id }));
        return;
      }

      const id = generateTabId();
      try {
        // Images are binary: never read them as text. Load metadata only and
        // let the image viewer render straight from the asset protocol. (No
        // file watch — the asset URL is static, so an on-disk change would not
        // refresh it anyway.) Documents load their text and start a watch.
        const isImage = isImageFile(path);
        let content: string | null;
        let metadata: FileMetadata | null;
        if (isImage) {
          content = null;
          // Same sandboxed-URI caveat as loadFileContent.
          metadata = isMobilePlatform()
            ? null
            : await invoke<FileMetadata>("get_file_metadata", { path });
        } else {
          ({ content, metadata } = await loadFileContent(path));
          // metadata is null exactly for mobile picker URIs, unwatchable too.
          if (metadata) {
            await invoke("watch_file", { path });
          }
        }
        // Notebooks, canvases, images, and D2 files are read-only; open straight
        // into the viewer regardless of the user's default editor mode. (`.d2`
        // content is fence-wrapped for rendering, so an editor would write the
        // wrapper back over the source.)
        const mode =
          isImage || isNotebookFile(path) || isCanvasFile(path) || isD2File(path)
            ? EDITOR_MODE.view
            : getDefaultEditorMode();
        const newTab: FileTab = {
          id,
          kind: "file",
          file: { ...makeFileState(path, mode), content, metadata },
        };
        setState((prev) => {
          const match = prev.tabs.find((tab) => tab.kind === "file" && tab.file.path === path);
          if (match) return { ...prev, activeTabId: match.id };
          return { tabs: [...prev.tabs, newTab], activeTabId: id };
        });
        addToRecent(path);
        // Remember workspace notes in `.glyph/state.json` (git-ignored) so the
        // workspace re-opens onto them next time. Fire-and-forget: a failure
        // here is never fatal to opening the file.
        const root = workspaceRef.current?.root;
        if (root && isPathInside(path, root)) {
          setWorkspaceLastFile(root, path).catch(() => {});
        }
      } catch (err) {
        console.error("Failed to open file:", err);
      }
    },
    [addToRecent, getDefaultEditorMode, setState, stateRef, workspaceRef],
  );

  // Open a fresh in-memory buffer (Untitled-N) in edit mode.
  const newDocument = useCallback(() => {
    const id = generateTabId();
    const title = nextUntitledTitle();
    const newTab: FileTab = {
      id,
      kind: "file",
      file: {
        ...makeFileState(title, EDITOR_MODE.edit),
        content: "",
        editContent: "",
        virtual: true,
      },
    };
    setState((prev) => ({ tabs: [...prev.tabs, newTab], activeTabId: id }));
  }, [setState]);

  // Open (or re-activate) the graph view of the workspace. The optional root
  // must match the open workspace (used by persisted-tab restore); without a
  // workspace the call is a no-op (the menu item is disabled in that state).
  const openGraph = useCallback(
    (root?: string) => {
      const wsRoot = workspaceRef.current?.root;
      if (!wsRoot || (root !== undefined && root !== wsRoot)) return;
      const id = generateTabId();
      setState((prev) => {
        const existing = prev.tabs.find((tab) => tab.kind === "graph");
        if (existing) return { ...prev, activeTabId: existing.id };
        const newTab: GraphTab = { id, kind: "graph", root: wsRoot, file: null };
        return { tabs: [...prev.tabs, newTab], activeTabId: id };
      });
    },
    [setState, workspaceRef],
  );

  const openFileDialog = useCallback(async () => {
    const selected = await pickFiles([
      {
        name: t("common:fileDialog.documents"),
        extensions: [...MARKDOWN_EXTENSIONS, ...NOTEBOOK_EXTENSIONS, ...D2_EXTENSIONS] as string[],
      },
      {
        name: t("common:fileDialog.markdown"),
        extensions: MARKDOWN_EXTENSIONS as string[],
      },
      {
        name: t("common:fileDialog.notebook"),
        extensions: NOTEBOOK_EXTENSIONS as string[],
      },
      {
        name: t("common:fileDialog.d2"),
        extensions: D2_EXTENSIONS as string[],
      },
    ]);
    if (selected) {
      for (const path of selected) {
        await openFile(path);
      }
    }
  }, [openFile, t]);

  return { openFile, newDocument, openGraph, openFileDialog };
}
