import { platform as detectPlatform } from "@tauri-apps/plugin-os";
import type { Platform } from "@/hooks/usePlatform";

const KNOWN_PLATFORMS: readonly Platform[] = ["macos", "windows", "linux", "android", "ios"];

/**
 * Detect and narrow the OS-plugin platform to Glyph's `Platform` union.
 * Falls back to `"unknown"` when the plugin is unavailable (tests, plain
 * browsers) or reports something Glyph has no styling/behavior for.
 */
export function currentPlatform(): Platform {
  try {
    const detected = detectPlatform();
    return (KNOWN_PLATFORMS as readonly string[]).includes(detected)
      ? (detected as Platform)
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function isMac(platform: Platform): boolean {
  return platform === "macos";
}

export function isMobile(platform: Platform): boolean {
  return platform === "android" || platform === "ios";
}

/**
 * Synchronous mobile check for code that runs before `usePlatform` state
 * settles (module-level helpers, first-render effects).
 */
export function isMobilePlatform(): boolean {
  return isMobile(currentPlatform());
}

export function modKey(platform: Platform): string {
  return isMac(platform) ? "⌘" : "Ctrl";
}
