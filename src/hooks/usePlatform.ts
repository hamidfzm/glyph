import { useEffect, useState } from "react";
import { currentPlatform } from "@/lib/platform";

export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "unknown";

export function usePlatform() {
  const [os, setOs] = useState<Platform>("unknown");

  useEffect(() => {
    const mapped = currentPlatform();
    setOs(mapped);
    document.documentElement.setAttribute("data-platform", mapped);
  }, []);

  return os;
}
