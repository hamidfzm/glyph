import type { ReactNode } from "react";
import type { Platform } from "@/hooks/usePlatform";
import { matchesPlatform, type PlatformSelector } from "@/lib/platform";

interface PlatformGateProps {
  platform: Platform;
  /** Where the children render: a group ("desktop" / "mobile"), a specific
   *  platform, or a list of either. */
  on: PlatformSelector | PlatformSelector[];
  children: ReactNode;
}

export function PlatformGate({ platform, on, children }: PlatformGateProps) {
  const selectors = Array.isArray(on) ? on : [on];
  return selectors.some((selector) => matchesPlatform(platform, selector)) ? children : null;
}
