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

export function useFileLoader() {
  const [state, setState] = useState<FileState>({
    content: null,
    metadata: null,
    loading: false,
    initializing: true,
    error: null,
  });

  const loadFile = useCallback(async (path: string) => {
    setState((prev) => ({ ...prev, loading: true, initializing: false, error: null }));
    try {
      const [content, metadata] = await Promise.all([
        invoke<string>("read_file", { path }),
        invoke<FileMetadata>("get_file_metadata", { path }),
      ]);
      await invoke("watch_file", { path });
      setState({ content, metadata, loading: false, initializing: false, error: null });
    } catch (err) {
      console.error("Failed to load file:", err);
      setState((prev) => ({
        ...prev,
        loading: false,
        initializing: false,
        error: String(err),
      }));
    }
  }, []);

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
      } else {
        setState((prev) => ({ ...prev, initializing: false }));
      }
    }).catch(() => {
      setState((prev) => ({ ...prev, initializing: false }));
    });
  }, [loadFile]);

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
