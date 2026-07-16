import { useEffect } from "react";
import { currentPlatform } from "@/lib/platform";

export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "unknown";

export function usePlatform() {
  // Constant for the process lifetime, so no state; reading it synchronously
  // keeps gates like ShowOn correct on the very first render.
  const os = currentPlatform();

  useEffect(() => {
    document.documentElement.setAttribute("data-platform", os);
  }, [os]);

  return os;
}
