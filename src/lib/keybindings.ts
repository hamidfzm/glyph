import type { Platform } from "@/hooks/usePlatform";
import { isMac } from "@/lib/platform";

// The single source of truth for every user-customizable keyboard shortcut.
//
// A binding is stored as a Tauri-style accelerator string ("CmdOrCtrl+Shift+O")
// so the same value drives both the in-app keydown matcher and the native menu
// accelerators (which the Rust side rebuilds when a binding changes). `CmdOrCtrl`
// resolves to Cmd on macOS and Ctrl elsewhere.

export type CommandCategory = "File" | "Edit" | "View" | "Application";

export interface BindableCommand {
  /** Stable id; for native-menu commands this equals the Rust menu item id. */
  id: string;
  label: string;
  category: CommandCategory;
  /** Default accelerator in Tauri format, e.g. "CmdOrCtrl+O". */
  defaultAccelerator: string;
  /** The `menu-*` event this command dispatches, when it routes through the menu
   *  action bus. Omitted for in-app-only commands like undo/redo. */
  event?: string;
  /** True when the command appears in the native menu, so a remap rebuilds the
   *  native accelerator (via the Rust `apply_keybindings` command). */
  nativeMenu: boolean;
}

// Order here is the display order in the Hotkeys settings pane.
export const BINDABLE_COMMANDS: readonly BindableCommand[] = [
  {
    id: "open",
    label: "Open File",
    category: "File",
    defaultAccelerator: "CmdOrCtrl+O",
    event: "menu-open-file",
    nativeMenu: true,
  },
  {
    id: "open-folder",
    label: "Open Folder",
    category: "File",
    defaultAccelerator: "CmdOrCtrl+Shift+O",
    event: "menu-open-folder",
    nativeMenu: true,
  },
  {
    id: "print",
    label: "Print",
    category: "File",
    defaultAccelerator: "CmdOrCtrl+P",
    event: "menu-print",
    nativeMenu: true,
  },
  {
    id: "close-tab",
    label: "Close Tab",
    category: "File",
    defaultAccelerator: "CmdOrCtrl+W",
    event: "menu-close-tab",
    nativeMenu: true,
  },
  {
    id: "close",
    label: "Close Window",
    category: "File",
    defaultAccelerator: "CmdOrCtrl+Shift+W",
    nativeMenu: true,
  },
  {
    id: "find",
    label: "Find in Document",
    category: "Edit",
    defaultAccelerator: "CmdOrCtrl+F",
    event: "menu-find",
    nativeMenu: true,
  },
  {
    id: "undo",
    label: "Undo (document edits)",
    category: "Edit",
    defaultAccelerator: "CmdOrCtrl+Z",
    nativeMenu: false,
  },
  {
    id: "redo",
    label: "Redo (document edits)",
    category: "Edit",
    defaultAccelerator: "CmdOrCtrl+Shift+Z",
    nativeMenu: false,
  },
  {
    id: "open-command-palette",
    label: "Command Palette",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+K",
    event: "menu-open-command-palette",
    nativeMenu: true,
  },
  {
    id: "toggle-files-sidebar",
    label: "Toggle Files Sidebar",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+B",
    event: "menu-toggle-files-sidebar",
    nativeMenu: true,
  },
  {
    id: "toggle-outline-sidebar",
    label: "Toggle Outline Sidebar",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+\\",
    event: "menu-toggle-outline-sidebar",
    nativeMenu: true,
  },
  {
    id: "toggle-edit",
    label: "Toggle Edit Mode",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+E",
    event: "menu-toggle-edit",
    nativeMenu: true,
  },
  {
    id: "open-graph",
    label: "Open Graph",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+G",
    event: "menu-open-graph",
    nativeMenu: true,
  },
  {
    id: "zoom-in",
    label: "Zoom In",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+=",
    event: "menu-zoom-in",
    nativeMenu: true,
  },
  {
    id: "zoom-out",
    label: "Zoom Out",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+-",
    event: "menu-zoom-out",
    nativeMenu: true,
  },
  {
    id: "actual-size",
    label: "Actual Size",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+0",
    event: "menu-zoom-reset",
    nativeMenu: true,
  },
  {
    id: "open-settings",
    label: "Settings",
    category: "Application",
    defaultAccelerator: "CmdOrCtrl+,",
    event: "menu-open-settings",
    nativeMenu: true,
  },
] as const;

const COMMAND_BY_ID = new Map(BINDABLE_COMMANDS.map((c) => [c.id, c]));

export function getBindableCommand(id: string): BindableCommand | undefined {
  return COMMAND_BY_ID.get(id);
}

// --- Accelerator parsing / matching -----------------------------------------

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
  const token = tokenFromCode(event.code);
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

// --- Resolution + conflicts --------------------------------------------------

export type BindingOverrides = Record<string, string>;

/** Merge default bindings with user overrides into a id -> accelerator map. */
export function resolveBindings(overrides: BindingOverrides = {}): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const command of BINDABLE_COMMANDS) {
    const override = overrides[command.id];
    resolved.set(
      command.id,
      override && override.length > 0 ? override : command.defaultAccelerator,
    );
  }
  return resolved;
}

/** Returns a set of command ids that share an accelerator with another command.
 *  Accelerators are compared in canonical (parsed) form so "Cmd+O" and
 *  "CmdOrCtrl+o" collide. */
export function findConflicts(resolved: Map<string, string>): Set<string> {
  const byCanonical = new Map<string, string[]>();
  for (const [id, accel] of resolved) {
    const parsed = parseAccelerator(accel);
    if (!parsed) continue;
    const canonical = canonicalKey(parsed);
    const ids = byCanonical.get(canonical) ?? [];
    ids.push(id);
    byCanonical.set(canonical, ids);
  }
  const conflicts = new Set<string>();
  for (const ids of byCanonical.values()) {
    if (ids.length > 1) for (const id of ids) conflicts.add(id);
  }
  return conflicts;
}

function canonicalKey(parsed: ParsedAccelerator): string {
  return [
    parsed.cmdOrCtrl ? "M" : "",
    parsed.alt ? "A" : "",
    parsed.shift ? "S" : "",
    parsed.key,
  ].join("|");
}
