import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

const AUTO_SAVE_DELAY = 2000;

interface UseAutoSaveOptions {
  path: string | undefined;
  content: string | null;
  dirty: boolean;
  onSaved: (content: string) => void;
}

export function useAutoSave({ path, content, dirty, onSaved }: UseAutoSaveOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    if (!path || !content || !dirty) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        await invoke("write_file", { path, content });
        onSavedRef.current(content);
      } catch (err) {
        console.error("Auto-save failed:", err);
      }
    }, AUTO_SAVE_DELAY);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [path, content, dirty]);
}
