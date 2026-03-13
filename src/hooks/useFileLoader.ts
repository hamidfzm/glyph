import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

interface FileMetadata {
  name: string;
  path: string;
  size: number;
  modified: number;
}

interface FileState {
  content: string | null;
  metadata: FileMetadata | null;
  loading: boolean;
  initializing: boolean;
  error: string | null;
}

const MAX_RECENT_FILES = 10;

export function useFileLoader(options?: {
  reopenLastFile?: boolean;
  recentFiles?: string[];
  onRecentFilesChange?: (files: string[]) => void;
  autoReload?: boolean;
}) {
  const [state, setState] = useState<FileState>({
    content: null,
    metadata: null,
    loading: false,
    initializing: true,
    error: null,
  });

  const addToRecent = useCallback(
    (path: string) => {
      if (!options?.onRecentFilesChange) return;
      const current = options.recentFiles ?? [];
      const updated = [path, ...current.filter((f) => f !== path)].slice(0, MAX_RECENT_FILES);
      options.onRecentFilesChange(updated);
    },
    [options],
  );

  const loadFile = useCallback(async (path: string) => {
    setState((prev) => ({ ...prev, loading: true, initializing: false, error: null }));
    try {
      const [content, metadata] = await Promise.all([
        invoke<string>("read_file", { path }),
        invoke<FileMetadata>("get_file_metadata", { path }),
      ]);
      await invoke("watch_file", { path });
      setState({ content, metadata, loading: false, initializing: false, error: null });
      addToRecent(path);
    } catch (err) {
      console.error("Failed to load file:", err);
      setState((prev) => ({
        ...prev,
        loading: false,
        initializing: false,
        error: String(err),
      }));
    }
  }, [addToRecent]);

  const openFileDialog = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Markdown",
          extensions: ["md", "markdown", "mdown", "mkd", "mkdn"],
        },
      ],
    });
    if (selected) {
      await loadFile(selected);
    }
  }, [loadFile]);

  // On mount, check if a file was passed via CLI args
  useEffect(() => {
    invoke<string | null>("get_initial_file").then((path) => {
      if (path) {
        loadFile(path);
      } else if (options?.reopenLastFile && options.recentFiles?.[0]) {
        loadFile(options.recentFiles[0]);
      } else {
        setState((prev) => ({ ...prev, initializing: false }));
      }
    }).catch(() => {
      setState((prev) => ({ ...prev, initializing: false }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also listen for open-file events (e.g. from file associations)
  useEffect(() => {
    const unlisten = listen<string>("open-file", (event) => {
      loadFile(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadFile]);

  return {
    ...state,
    loadFile,
    openFileDialog,
  };
}
