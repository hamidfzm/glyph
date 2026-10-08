import { hasExtension, MARKDOWN_EXTENSIONS } from "@/lib/extensionConfig";
import type { DailyNotesSettings } from "@/lib/workspace";

const pad2 = (value: number) => String(value).padStart(2, "0");

const DATE_TOKENS: Record<string, (date: Date) => string> = {
  YYYY: (date) => String(date.getFullYear()).padStart(4, "0"),
  YY: (date) => pad2(date.getFullYear() % 100),
  MM: (date) => pad2(date.getMonth() + 1),
  M: (date) => String(date.getMonth() + 1),
  DD: (date) => pad2(date.getDate()),
  D: (date) => String(date.getDate()),
};

// Longest token first, so `YYYY` is not read as `YY` twice.
const DATE_PATTERN = /\[([^\]]*)\]|YYYY|YY|MM|M|DD|D/g;

/** Fills the date tokens from the local `date`; `[text]` in brackets is kept as written. */
export function formatDatePattern(pattern: string, date: Date): string {
  return pattern.replace(DATE_PATTERN, (token: string, literal: string | undefined) =>
    literal === undefined ? DATE_TOKENS[token](date) : literal,
  );
}

/** Always a markdown file name: `.md` is added when the pattern names no markdown extension. */
export function dailyNoteName(pattern: string, date: Date): string {
  const trimmed = pattern.trim();
  if (!hasExtension(trimmed, MARKDOWN_EXTENSIONS)) {
    return `${formatDatePattern(trimmed, date)}.md`;
  }
  // The extension is set aside so its letters are never read as tokens.
  const dot = trimmed.lastIndexOf(".");
  return formatDatePattern(trimmed.slice(0, dot), date) + trimmed.slice(dot);
}

/** Forward-slash segments from either separator; empty and `.` segments are dropped. */
export function normalizeRelativePath(path: string): string {
  return path
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

/** Workspace-relative path of the note for `date`. */
export function dailyNotePath(settings: DailyNotesSettings, date: Date): string {
  const name = dailyNoteName(settings.filenamePattern, date);
  return normalizeRelativePath(`${settings.folder}/${name}`);
}

/** `settings` as they are stored: paths normalized, a blank template dropped. */
export function normalizeDailyNotes(settings: DailyNotesSettings): DailyNotesSettings {
  const template = normalizeRelativePath(settings.template ?? "");
  return {
    folder: normalizeRelativePath(settings.folder),
    filenamePattern: settings.filenamePattern.trim(),
    template: template === "" ? undefined : template,
  };
}

// `..` leaves the workspace; the other characters cannot be in a file name on Windows.
const UNSAFE_SEGMENT = /^\.\.$|[<>:"|?*]/;

type DailyNotesProblem = "patternRequired" | "invalidPath";

/** Checked on save and again before creating: `.glyph/config.json` can be edited by hand. */
export function dailyNotesProblem(
  settings: DailyNotesSettings,
  date: Date,
): DailyNotesProblem | null {
  if (settings.filenamePattern.trim() === "") return "patternRequired";
  const paths = [dailyNotePath(settings, date), normalizeRelativePath(settings.template ?? "")];
  const unsafe = paths.some((path) =>
    path.split("/").some((segment) => UNSAFE_SEGMENT.test(segment)),
  );
  return unsafe ? "invalidPath" : null;
}
