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
  filesSidebarWidth: number;
  outlineSidebarWidth: number;
  aiPanelWidth: number;
  // Pixel height of the backlinks block inside the Files panel. null keeps its
  // natural height until the user drags the divider.
  backlinksHeight: number | null;
  // Same, for the tag cloud block.
  tagsHeight: number | null;
  // Collapsed state of the two blocks, kept workspace-wide so switching files
  // doesn't reshuffle the panel.
  backlinksCollapsed: boolean;
  tagsCollapsed: boolean;
  sidebarLayout: SidebarLayout;
  // Mirrors the sidebar layout. Default Files-left / Outline-right; when true
  // it becomes Files-right / Outline-left. Affects all layout modes.
  swapSidebarSides: boolean;
}

// Drag-resize bounds. Sidebar panels share one range; the AI panel's upper
// bound is 45vw, resolved against the window at drag time (and enforced by its
// CSS max-width).
export const SIDEBAR_WIDTH_DEFAULT = 224;
export const SIDEBAR_WIDTH_MIN = 160;
export const SIDEBAR_WIDTH_MAX = 480;
export const AI_PANEL_WIDTH_DEFAULT = 340;
export const AI_PANEL_WIDTH_MIN = 280;
export const AI_PANEL_WIDTH_MAX_FRACTION = 0.45;
export const BACKLINKS_HEIGHT_MIN = 80;
export const TAGS_HEIGHT_MIN = 56;

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
 * starts at `edit`. On a narrow viewport `canSplit` is false, so the cycle
 * skips split (view → edit → view).
 */
export function nextEditorMode(current: EditorMode | undefined, canSplit = true): EditorMode {
  const cycle = canSplit ? EDITOR_MODE_CYCLE : [EDITOR_MODE.view, EDITOR_MODE.edit];
  const idx = current ? cycle.indexOf(current) : 0;
  // indexOf is -1 when the stored mode is split but split is no longer in the
  // cycle; treat that as position 0 so the next tap lands on edit.
  return cycle[((idx < 0 ? 0 : idx) + 1) % cycle.length];
}

/**
 * The mode to actually render. Split needs two panes' worth of width, so on a
 * narrow viewport (`canSplit` false) a tab stored as split falls back to the
 * read-only view. The stored mode is left untouched, so widening restores it.
 */
export function effectiveEditorMode(mode: EditorMode, canSplit: boolean): EditorMode {
  return mode === EDITOR_MODE.split && !canSplit ? EDITOR_MODE.view : mode;
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
  // When off, edits stay dirty until an explicit Save, and a close that would
  // drop them prompts Save / Don't Save / Cancel instead of flush-saving.
  autoSave: boolean;
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
  // Answer to the first-run "make Glyph your default Markdown app?" prompt.
  // The prompt auto-shows only while "unanswered", so any other value stops it
  // from nagging; the Settings action stays available regardless.
  defaultAppPrompt: DefaultAppPrompt;
}

export type DefaultAppPrompt = "unanswered" | "notNow" | "never" | "set";

export interface AISettings {
  provider: "none" | "claude" | "openai" | "ollama";
  /** In-memory only: loaded from the OS keychain on startup and stripped from
   *  every settings.json write (see stripSecrets). */
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
  /** Largest media file packaged into an EPUB, in MB; "off" names the media instead. */
  epubMediaLimit: EpubMediaLimit;
}

// Only EPUB can carry media: it is a zip, so the bytes land inside the file the
// user picked. HTML, DOCX, and PDF always link instead. Readers choke on huge
// books, hence the ceiling.
export type EpubMediaLimit = "off" | "10" | "50" | "100";

export const EPUB_MEDIA_LIMITS: readonly EpubMediaLimit[] = ["off", "10", "50", "100"];

// "off", and any value a settings file written by an older build is missing,
// come back as 0: no embedding, so the media is named instead.
export function epubMediaLimitBytes(limit: EpubMediaLimit): number {
  const mb = Number(limit);
  return Number.isFinite(mb) ? mb * 1024 * 1024 : 0;
}

export interface PrivacySettings {
  // Opt-in crash/error reporting to Sentry. Off by default — nothing leaves the
  // machine until the user turns this on, and it stays inert in dev builds.
  errorReporting: boolean;
  // Answer to the first-run "enable crash reporting?" banner. The banner shows
  // only while "unanswered", so either answer stops it permanently; the Settings
  // toggle stays the authoritative control.
  errorReportingPrompt: ErrorReportingPrompt;
}

export type ErrorReportingPrompt = "unanswered" | "enabled" | "declined";

// Editor keymap preset for the markdown editor pane. "default" is Glyph's own
// (CodeMirror default) bindings; "vim" and "vscode" load the matching keymap.
export type EditorKeymap = "default" | "vim" | "vscode";

export interface EditorSettings {
  keymap: EditorKeymap;
  // Underline misspelled words in the editor (edit and split modes). Off by
  // default; dictionaries only load once enabled.
  spellCheck: boolean;
  // Enabled dictionary languages. A word is checked against every enabled
  // dictionary covering its script and flagged only when all of them reject
  // it; words in scripts no enabled dictionary covers are skipped. An empty
  // array checks nothing.
  spellCheckLanguages: string[];
  // Convert a rich-text (text/html) paste into Markdown before inserting it.
  // Off falls back to the plain-text clipboard flavor, as does a conversion
  // that fails or yields nothing.
  pasteHtmlAsMarkdown: boolean;
  // Link the two split-view panes so scrolling either moves the other to the
  // matching relative position. Off leaves each pane scrolling on its own.
  syncScroll: boolean;
}

export interface KeybindingSettings {
  // Map of bindable command id -> accelerator override (Tauri "CmdOrCtrl+..."
  // format). Command ids absent from the map fall back to their default
  // binding. Stored and updated as a whole object, not per-key, because the
  // settings validator allowlists path segments against the defaults shape.
  overrides: Record<string, string>;
}

// Which optional markdown syntax extensions render. All on by default; turning
// one off drops its plugin from the pipeline, so the raw syntax stays literal
// (e.g. $x$ renders as plain text with math off).
export interface MarkdownSettings {
  /** GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks. */
  gfm: boolean;
  /** Math rendering via KaTeX: $inline$ and $$block$$. */
  math: boolean;
  /** GitHub blockquote alerts: > [!NOTE], [!TIP], … */
  alerts: boolean;
  /** Emoji shortcodes: :smile: */
  emoji: boolean;
  /** [[wikilink]] resolution against the workspace. */
  wikilinks: boolean;
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
  markdown: MarkdownSettings;
}

/** Copy of `settings` that is safe to persist: provider API keys live in the
 *  OS keychain, never in settings.json. */
export function stripSecrets(settings: Settings): Settings {
  return { ...settings, ai: { ...settings.ai, apiKeys: {} } };
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
    filesSidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    outlineSidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    aiPanelWidth: AI_PANEL_WIDTH_DEFAULT,
    backlinksHeight: null,
    tagsHeight: null,
    backlinksCollapsed: false,
    tagsCollapsed: false,
    sidebarLayout: "beside",
    swapSidebarSides: false,
  },
  behavior: {
    autoReload: true,
    autoSave: true,
    reopenLastFile: false,
    confirmExternalLinks: true,
    checkForUpdates: true,
    recentFiles: [],
    openTabs: [],
    activeTabPath: "",
    defaultEditorMode: EDITOR_MODE.view,
    defaultAppPrompt: "unanswered",
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
    epubMediaLimit: "10",
  },
  privacy: {
    errorReporting: false,
    errorReportingPrompt: "unanswered",
  },
  keybindings: {
    overrides: {},
  },
  editor: {
    keymap: "default",
    spellCheck: false,
    spellCheckLanguages: ["en"],
    pasteHtmlAsMarkdown: true,
    syncScroll: true,
  },
  markdown: {
    gfm: true,
    math: true,
    alerts: true,
    emoji: true,
    wikilinks: true,
  },
};
