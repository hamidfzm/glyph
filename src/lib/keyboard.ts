import type { Platform } from "@/hooks/usePlatform";
import { isMac } from "@/lib/platform";

export const KEYBOARD_EVENT = {
  KeyDown: "keydown",
} as const;

const Key = {
  Z: "z",
  Y: "y",
} as const;

function hasPlatformModifier(event: KeyboardEvent, platform: Platform): boolean {
  return isMac(platform) ? event.metaKey : event.ctrlKey;
}

export function matchesUndoShortcut(event: KeyboardEvent, platform: Platform): boolean {
  if (!hasPlatformModifier(event, platform) || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === Key.Z;
}

export function matchesRedoShortcut(event: KeyboardEvent, platform: Platform): boolean {
  if (!hasPlatformModifier(event, platform) || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key === Key.Z && event.shiftKey) return true;
  // Ctrl+Y is the Windows/Linux convention for redo; macOS uses Shift+Cmd+Z.
  return !isMac(platform) && key === Key.Y && !event.shiftKey;
}
