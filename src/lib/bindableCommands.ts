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
    id: "save",
    label: "Save",
    category: "File",
    defaultAccelerator: "CmdOrCtrl+S",
    event: "menu-save",
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
  // Editor-only inline formatting. Bold defaults to Shift because CmdOrCtrl+B
  // is Toggle Files Sidebar; remap either one in Settings -> Hotkeys.
  {
    id: "format-bold",
    label: "Bold",
    category: "Edit",
    defaultAccelerator: "CmdOrCtrl+Shift+B",
    nativeMenu: false,
  },
  {
    id: "format-italic",
    label: "Italic",
    category: "Edit",
    defaultAccelerator: "CmdOrCtrl+I",
    nativeMenu: false,
  },
  {
    id: "format-code",
    label: "Inline Code",
    category: "Edit",
    defaultAccelerator: "CmdOrCtrl+Shift+C",
    nativeMenu: false,
  },
  {
    id: "format-strikethrough",
    label: "Strikethrough",
    category: "Edit",
    defaultAccelerator: "CmdOrCtrl+Shift+X",
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
    id: "move-tab-left",
    label: "Move Tab Left",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+Shift+PageUp",
    nativeMenu: false,
  },
  {
    id: "move-tab-right",
    label: "Move Tab Right",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+Shift+PageDown",
    nativeMenu: false,
  },
  // Obsidian's defaults. CmdOrCtrl+[ / ] would collide with the editor's indent
  // bindings and Alt+Left / Right with word-wise cursor movement on macOS.
  {
    id: "navigate-back",
    label: "Go Back",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+Alt+Left",
    nativeMenu: false,
  },
  {
    id: "navigate-forward",
    label: "Go Forward",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+Alt+Right",
    nativeMenu: false,
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
    id: "ai-chat",
    label: "AI Chat",
    category: "View",
    defaultAccelerator: "CmdOrCtrl+Shift+A",
    event: "menu-ai-chat",
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
