import type { Platform } from "@/hooks/usePlatform";
import { isMac } from "@/lib/platform";

// Parsing, matching, and display of Tauri-style accelerator strings
// ("CmdOrCtrl+Shift+O"). The command table that uses them lives in
// bindableCommands.ts.

export interface ParsedAccelerator {
  cmdOrCtrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Canonical key token, e.g. "O", "5", ",", "\\", "Up". */
  key: string;
}

// Maps a KeyboardEvent.code to its canonical accelerator key token. Physical-key
// based (like VS Code) so bindings survive keyboard-layout differences.
const CODE_TO_TOKEN: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Delete: "Delete",
  Backspace: "Backspace",
};

function tokenFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return CODE_TO_TOKEN[code] ?? null;
}

// `code` is the physical key and is layout-independent, so it is preferred. Some
// input paths (virtual keyboards, remote sessions, synthesized events) deliver
// an empty `code`; fall back to the produced character so the binding still
// matches instead of silently doing nothing.
function tokenFromEvent(event: KeyboardEvent): string | null {
  const fromCode = tokenFromCode(event.code);
  if (fromCode !== null) return fromCode;
  const key = event.key;
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  return CODE_TO_TOKEN[key] ?? null;
}

const MODIFIER_TOKENS = new Set(["CmdOrCtrl", "Cmd", "Ctrl", "Control", "Command", "Alt", "Shift"]);

/** Parse a Tauri-style accelerator string into its parts, or null if invalid. */
export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator.split("+").map((p) => p.trim());
  let cmdOrCtrl = false;
  let alt = false;
  let shift = false;
  let key: string | null = null;
  for (const part of parts) {
    if (
      part === "CmdOrCtrl" ||
      part === "Cmd" ||
      part === "Ctrl" ||
      part === "Control" ||
      part === "Command"
    ) {
      cmdOrCtrl = true;
    } else if (part === "Alt" || part === "Option") {
      alt = true;
    } else if (part === "Shift") {
      shift = true;
    } else {
      // The key token. A second non-modifier means a malformed accelerator.
      if (key !== null) return null;
      key = normalizeKeyToken(part);
    }
  }
  if (key === null) return null;
  return { cmdOrCtrl, alt, shift, key };
}

function normalizeKeyToken(token: string): string {
  if (token.length === 1) return token.toUpperCase();
  return token;
}

/** Build a canonical accelerator string from a keydown event, or null if only
 *  modifier keys (or an unmappable key) are held. */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const token = tokenFromCode(event.code);
  if (token === null || MODIFIER_TOKENS.has(token)) return null;
  const mods: string[] = [];
  if (event.metaKey || event.ctrlKey) mods.push("CmdOrCtrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  return [...mods, token].join("+");
}

/** True when the event matches the given accelerator on this platform. */
export function matchesAccelerator(
  event: KeyboardEvent,
  accelerator: string,
  platform: Platform,
): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;
  const token = tokenFromEvent(event);
  if (token === null) return false;
  const cmdOrCtrl = isMac(platform) ? event.metaKey : event.ctrlKey;
  // The "other" primary modifier must not be held, so Ctrl+O on macOS doesn't
  // trigger a Cmd+O binding.
  const otherPrimary = isMac(platform) ? event.ctrlKey : event.metaKey;
  return (
    cmdOrCtrl === parsed.cmdOrCtrl &&
    !otherPrimary &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    token === parsed.key
  );
}

// --- Display formatting ------------------------------------------------------

const TOKEN_SYMBOLS_MAC: Record<string, string> = {
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Enter: "↵",
  Space: "Space",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
};

/** Human-readable rendering of an accelerator, e.g. "⌘⇧O" on macOS or
 *  "Ctrl+Shift+O" elsewhere. */
export function formatAccelerator(accelerator: string, platform: Platform): string {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return accelerator;
  const mac = isMac(platform);
  const keyLabel = (mac ? TOKEN_SYMBOLS_MAC[parsed.key] : undefined) ?? parsed.key;
  if (mac) {
    return (
      (parsed.cmdOrCtrl ? "⌘" : "") + (parsed.alt ? "⌥" : "") + (parsed.shift ? "⇧" : "") + keyLabel
    );
  }
  const parts: string[] = [];
  if (parsed.cmdOrCtrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(keyLabel);
  return parts.join("+");
}
