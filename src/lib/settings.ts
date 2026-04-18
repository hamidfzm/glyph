export interface AppearanceSettings {
  theme: "system" | "light" | "dark";
  fontFamily: "system" | "serif" | "sans" | "mono" | "custom";
  customFont: string;
  fontSize: number;
  lineHeight: "compact" | "normal" | "relaxed";
  contentWidth: "narrow" | "medium" | "wide" | "full";
  codeFont: string;
  codeTheme: "glyph" | "github" | "monokai" | "nord" | "solarized-light" | "solarized-dark";
}

export interface LayoutSettings {
  sidebarVisible: boolean;
  sidebarPosition: "left" | "right";
  sidebarWidth: number;
}

export type EditorMode = "view" | "edit" | "split";

export interface BehaviorSettings {
  autoReload: boolean;
  reopenLastFile: boolean;
  confirmExternalLinks: boolean;
  recentFiles: string[];
  openTabs: string[];
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

export interface Settings {
  appearance: AppearanceSettings;
  layout: LayoutSettings;
  behavior: BehaviorSettings;
  ai: AISettings;
  print: PrintSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: {
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
    sidebarVisible: true,
    sidebarPosition: "left",
    sidebarWidth: 224,
  },
  behavior: {
    autoReload: true,
    reopenLastFile: false,
    confirmExternalLinks: true,
    recentFiles: [],
    openTabs: [],
    activeTabPath: "",
    defaultEditorMode: "view",
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
