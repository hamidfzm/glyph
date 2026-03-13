import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

export function useFileWatcher(onFileChanged: () => void) {
  const callbackRef = useRef(onFileChanged);
  callbackRef.current = onFileChanged;

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const unlisten = listen("file-changed", () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        callbackRef.current();
      }, 300);
    });

    return () => {
      clearTimeout(timeout);
      unlisten.then((fn) => fn());
    };
  }, []);
}
