import { platform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";

export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "unknown";

const KNOWN_PLATFORMS: readonly Platform[] = ["macos", "windows", "linux", "android", "ios"];

export function usePlatform() {
  const [os, setOs] = useState<Platform>("unknown");

  useEffect(() => {
    const detected = platform();
    const mapped: Platform = (KNOWN_PLATFORMS as readonly string[]).includes(detected)
      ? (detected as Platform)
      : "unknown";

    setOs(mapped);
    document.documentElement.setAttribute("data-platform", mapped);
  }, []);

  return os;
}
