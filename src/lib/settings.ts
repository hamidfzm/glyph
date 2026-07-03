export interface AppearanceSettings {
  // UI language. "system" follows the OS locale (see useLocale); otherwise a
  // BCP-47 code from the supported set in src/lib/locales.ts.
  locale: string;
  theme: "system" | "light" | "dark";
  fontFamily: "system" | "serif" | "sans" | "mono" | "custom";
  customFont: string;
  fontSize: number;
  lineHeight: "compact" | "normal" | "relaxed";
  contentWidth: "narrow" | "medium" | "wide" | "full";
  codeFont: string;
  codeTheme: "glyph" | "github" | "monokai" | "nord" | "solarized-light" | "solarized-dark";
}

// How Files and Outline panels are arranged in folder tabs.
//   split    — Files on one side, Outline on the other (default).
//   combined — both stacked vertically in a single panel on the same side.
//   beside   — two separate panels sitting next to each other on the same side.
// File tabs only show Outline, so this only affects folder tabs.
export type SidebarLayout = "split" | "combined" | "beside";

export interface LayoutSettings {
  // Toggles the Files panel (only meaningful in folder tabs).
  filesSidebarVisible: boolean;
  // Toggles the Outline panel (visible in both file and folder tabs).
  outlineSidebarVisible: boolean;
  sidebarWidth: number;
  sidebarLayout: SidebarLayout;
  // Mirrors the sidebar layout. Default Files-left / Outline-right; when true
  // it becomes Files-right / Outline-left. Affects all layout modes.
  swapSidebarSides: boolean;
}

// Editor modes for a document tab. Defined as a constant object so call sites
// reference `EDITOR_MODE.view` etc. instead of bare string literals; the
// `EditorMode` union is derived from it so the two never drift.
export const EDITOR_MODE = {
  view: "view",
  edit: "edit",
  split: "split",
} as const;

export type EditorMode = (typeof EDITOR_MODE)[keyof typeof EDITOR_MODE];

// Order the per-tab mode toggle cycles through: view → edit → split → view.
const EDITOR_MODE_CYCLE: readonly EditorMode[] = [
  EDITOR_MODE.view,
  EDITOR_MODE.edit,
  EDITOR_MODE.split,
];

/**
 * The next mode when cycling the editor toggle (wraps view → edit → split →
 * view). An undefined/unknown current mode is treated as `view`, so the cycle
 * starts at `edit`.
 */
export function nextEditorMode(current: EditorMode | undefined): EditorMode {
  const idx = current ? EDITOR_MODE_CYCLE.indexOf(current) : 0;
  return EDITOR_MODE_CYCLE[(idx + 1) % EDITOR_MODE_CYCLE.length];
}

export interface PersistedTab {
  kind: "file" | "folder" | "graph";
  // File path for file tabs; workspace root for folder and graph tabs.
  path: string;
  filePath?: string;
  expanded?: string[];
}

export interface BehaviorSettings {
  autoReload: boolean;
  reopenLastFile: boolean;
  confirmExternalLinks: boolean;
  // Check GitHub for a newer release on launch and show a banner when one is
  // available. On by default; only the running version is compared, nothing is
  // uploaded.
  checkForUpdates: boolean;
  recentFiles: string[];
  // Each entry is a tab to restore on launch; either a single file or a folder
  // workspace with optional active-file + expanded subdir state.
  openTabs: PersistedTab[];
  // Path of the previously-active tab (root for folder tabs, file path for file
  // tabs). Used to restore which tab is selected on launch.
  activeTabPath: string;
  defaultEditorMode: EditorMode;
}

export interface AISettings {
  provider: "none" | "claude" | "openai" | "ollama";
  apiKeys: Record<string, string>;
  ollamaUrl: string;
  model: string;
  ttsVoice: string;
  ttsSpeed: number;
}

export interface PrintSettings {
  pageBreakLevel: "none" | "h1" | "h2";
  includeToc: boolean;
  includeBackground: boolean;
}

export interface PrivacySettings {
  // Opt-in crash/error reporting to Sentry. Off by default — nothing leaves the
  // machine until the user turns this on, and it stays inert in dev builds.
  errorReporting: boolean;
}

// Editor keymap preset for the markdown editor pane. "default" is Glyph's own
// (CodeMirror default) bindings; "vim" and "vscode" load the matching keymap.
export type EditorKeymap = "default" | "vim" | "vscode";

export interface EditorSettings {
  keymap: EditorKeymap;
  // Underline misspelled words in the editor (edit and split modes). Off by
  // default; the dictionary only loads once enabled.
  spellCheck: boolean;
  // Dictionary language for spell check, as a folder name under
  // public/dictionaries (currently only "en" ships).
  spellCheckLanguage: string;
}

export interface KeybindingSettings {
  // Map of bindable command id -> accelerator override (Tauri "CmdOrCtrl+..."
  // format). Command ids absent from the map fall back to their default
  // binding. Stored and updated as a whole object, not per-key, because the
  // settings validator allowlists path segments against the defaults shape.
  overrides: Record<string, string>;
}

export interface Settings {
  appearance: AppearanceSettings;
  layout: LayoutSettings;
  behavior: BehaviorSettings;
  ai: AISettings;
  print: PrintSettings;
  privacy: PrivacySettings;
  keybindings: KeybindingSettings;
  editor: EditorSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: {
    locale: "system",
    theme: "system",
    fontFamily: "system",
    customFont: "",
    fontSize: 16,
    lineHeight: "normal",
    contentWidth: "medium",
    codeFont: "",
    codeTheme: "glyph",
  },
  layout: {
    filesSidebarVisible: true,
    outlineSidebarVisible: true,
    sidebarWidth: 224,
    sidebarLayout: "beside",
    swapSidebarSides: false,
  },
  behavior: {
    autoReload: true,
    reopenLastFile: false,
    confirmExternalLinks: true,
    checkForUpdates: true,
    recentFiles: [],
    openTabs: [],
    activeTabPath: "",
    defaultEditorMode: EDITOR_MODE.view,
  },
  ai: {
    provider: "none",
    apiKeys: {},
    ollamaUrl: "http://localhost:11434",
    model: "",
    ttsVoice: "",
    ttsSpeed: 1.0,
  },
  print: {
    pageBreakLevel: "none",
    includeToc: false,
    includeBackground: false,
  },
  privacy: {
    errorReporting: false,
  },
  keybindings: {
    overrides: {},
  },
  editor: {
    keymap: "default",
    spellCheck: false,
    spellCheckLanguage: "en",
  },
};

export const ZOOM_DEFAULT = 16;
export const ZOOM_MIN = 8;
export const ZOOM_MAX = 32;
export const ZOOM_STEP = 1;

export const FONT_FAMILY_MAP: Record<string, string> = {
  system: "",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
};

export const LINE_HEIGHT_MAP: Record<string, string> = {
  compact: "1.5",
  normal: "1.7",
  relaxed: "2.0",
};

export const CONTENT_WIDTH_MAP: Record<string, string> = {
  narrow: "640px",
  medium: "800px",
  wide: "1024px",
  full: "100%",
};

export const MODEL_SUGGESTIONS: Record<string, string[]> = {
  claude: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  ollama: ["llama3.2", "mistral", "gemma2"],
};
