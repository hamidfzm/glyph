import type { ReactNode } from "react";
import { usePlatform } from "@/hooks/usePlatform";
import { matchesPlatform, type PlatformSelector } from "@/lib/platform";

interface ShowOnProps {
  /** Where the children render: a group ("desktop" / "mobile"), a specific
   *  platform, or a list of either. */
  on: PlatformSelector | PlatformSelector[];
  children: ReactNode;
}

export function ShowOn({ on, children }: ShowOnProps) {
  const platform = usePlatform();
  const selectors = Array.isArray(on) ? on : [on];
  return selectors.some((selector) => matchesPlatform(platform, selector)) ? children : null;
}
