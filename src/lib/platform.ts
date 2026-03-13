import type { Platform } from "../hooks/usePlatform";

export function isMac(platform: Platform): boolean {
  return platform === "macos";
}

export function modKey(platform: Platform): string {
  return isMac(platform) ? "⌘" : "Ctrl";
}
