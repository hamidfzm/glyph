import { platform as detectPlatform } from "@tauri-apps/plugin-os";
import type { Platform } from "@/hooks/usePlatform";

const KNOWN_PLATFORMS: readonly Platform[] = ["macos", "windows", "linux", "android", "ios"];

/** Detect and narrow to Glyph's `Platform` union; `"unknown"` when the OS
 *  plugin is unavailable (tests, plain browsers) or reports something else. */
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

/** A platform group or a single platform, for cfg-style UI gating. */
export type PlatformSelector = "desktop" | "mobile" | Platform;

export function matchesPlatform(platform: Platform, selector: PlatformSelector): boolean {
  if (selector === "desktop") return !isMobile(platform);
  if (selector === "mobile") return isMobile(platform);
  return platform === selector;
}

/** Synchronous mobile check for code that runs before `usePlatform` settles. */
export function isMobilePlatform(): boolean {
  return isMobile(currentPlatform());
}

export function modKey(platform: Platform): string {
  return isMac(platform) ? "⌘" : "Ctrl";
}
