import { useEffect, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";

export type Platform = "macos" | "windows" | "linux" | "unknown";

export function usePlatform() {
  const [os, setOs] = useState<Platform>("unknown");

  useEffect(() => {
    const detected = platform();
    const mapped: Platform =
      detected === "macos"
        ? "macos"
        : detected === "windows"
          ? "windows"
          : detected === "linux"
            ? "linux"
            : "unknown";

    setOs(mapped);
    document.documentElement.setAttribute("data-platform", mapped);
  }, []);

  return os;
}
