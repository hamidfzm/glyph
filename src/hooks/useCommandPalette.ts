import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { Platform } from "@/hooks/usePlatform";
import { KEYBOARD_EVENT, matchesCommandPaletteShortcut } from "@/lib/keyboard";

interface UseCommandPaletteOptions {
  platform: Platform;
}

// Owns the command palette's open state, the query string, and the global
// Cmd/Ctrl+K binding. The keyboard listener defers to CodeMirror when focus is
// inside the editor pane so users can still type "k" with the modifier without
// hijacking the editor's chord-style shortcuts.
export function useCommandPalette({ platform }: UseCommandPaletteOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const openPalette = useCallback(() => {
    setQuery("");
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (prev) return false;
      setQuery("");
      return true;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesCommandPaletteShortcut(event, platform)) return;
      const target = event.target as Element | null;
      if (target?.closest(".cm-editor")) return;
      event.preventDefault();
      toggle();
    };
    document.addEventListener(KEYBOARD_EVENT.KeyDown, onKeyDown);
    return () => document.removeEventListener(KEYBOARD_EVENT.KeyDown, onKeyDown);
  }, [platform, toggle]);

  // The native View menu's "Command Palette…" item emits this event so users
  // who don't know the Cmd/Ctrl+K accelerator can still discover the feature.
  useEffect(() => {
    const unlisten = listen("menu-open-command-palette", () => openPalette());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openPalette]);

  return { open, query, setQuery, openPalette, closePalette };
}
