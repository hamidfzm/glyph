import { useEffect, useState } from "react";
import { currentPlatform } from "@/lib/platform";

export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "unknown";

export function usePlatform() {
  // Seeded synchronously: the platform never changes at runtime, and gates
  // like ShowOn must be correct on the very first render.
  const [os] = useState<Platform>(currentPlatform);

  useEffect(() => {
    document.documentElement.setAttribute("data-platform", os);
  }, [os]);

  return os;
}
