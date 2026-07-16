import type { ReactNode } from "react";
import { usePlatform } from "@/hooks/usePlatform";
import { isMobile } from "@/lib/platform";

interface ShowOnProps {
  on: "desktop" | "mobile";
  children: ReactNode;
}

export function ShowOn({ on, children }: ShowOnProps) {
  const current = isMobile(usePlatform()) ? "mobile" : "desktop";
  if (current !== on) return null;
  return children;
}
