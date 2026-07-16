import { platform as detectPlatform } from "@tauri-apps/plugin-os";
import type { Platform } from "@/hooks/usePlatform";

export function isMac(platform: Platform): boolean {
  return platform === "macos";
}

export function isMobile(platform: Platform): boolean {
  return platform === "android" || platform === "ios";
}

/**
 * Synchronous mobile check for code that runs before `usePlatform` state
 * settles (module-level helpers, first-render effects). Falls back to desktop
 * when the OS plugin is unavailable (tests, plain browsers).
 */
export function isMobilePlatform(): boolean {
  try {
    const detected = detectPlatform();
    return detected === "android" || detected === "ios";
  } catch {
    return false;
  }
}

export function modKey(platform: Platform): string {
  return isMac(platform) ? "⌘" : "Ctrl";
}
