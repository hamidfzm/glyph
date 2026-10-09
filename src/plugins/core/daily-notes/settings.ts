import { normalizeRelativePath } from "./notePath";

/** Paths are workspace-relative with forward slashes. */
export interface DailyNotesSettings {
  /** Empty means the workspace root. */
  folder: string;
  /** File name for a day, with the date tokens of `formatDatePattern`. */
  filenamePattern: string;
  /** File a new note starts as a copy of; empty for a blank note. */
  template: string;
}

export const DEFAULT_SETTINGS: DailyNotesSettings = {
  folder: "daily",
  filenamePattern: "YYYY-MM-DD.md",
  template: "",
};

/** What the workspace stored, with the default for any value that is missing or not text. */
export function readSettings(stored: Record<string, unknown>): DailyNotesSettings {
  const text = (key: keyof DailyNotesSettings) => {
    const value = stored[key];
    return typeof value === "string" ? value : DEFAULT_SETTINGS[key];
  };
  return {
    folder: text("folder"),
    filenamePattern: text("filenamePattern"),
    template: text("template"),
  };
}

/** `settings` as they are stored: paths normalized, the pattern trimmed. */
export function storedSettings(settings: DailyNotesSettings): DailyNotesSettings {
  return {
    folder: normalizeRelativePath(settings.folder),
    filenamePattern: settings.filenamePattern.trim(),
    template: normalizeRelativePath(settings.template),
  };
}
