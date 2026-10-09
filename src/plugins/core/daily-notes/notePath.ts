import type { DailyNotesSettings } from "./settings";

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

/** Always a `.md` file name: the extension is added when the pattern does not end in it. */
export function dailyNoteName(pattern: string, date: Date): string {
  const trimmed = pattern.trim();
  // Set aside before formatting, so the extension's letters are never read as tokens.
  const extension = /\.md$/i.exec(trimmed)?.[0] ?? "";
  const stem = trimmed.slice(0, trimmed.length - extension.length);
  return formatDatePattern(stem, date) + (extension || ".md");
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

// `..` leaves the workspace; the other characters cannot be in a file name on Windows.
const UNSAFE_SEGMENT = /^\.\.$|[<>:"|?*]/;

export type DailyNotesProblem = "patternRequired" | "invalidPath" | "hiddenPath";

/** Checked on save and again before creating: `.glyph/config.json` can be edited by hand. */
export function dailyNotesProblem(
  settings: DailyNotesSettings,
  date: Date,
): DailyNotesProblem | null {
  if (settings.filenamePattern.trim() === "") return "patternRequired";
  const note = dailyNotePath(settings, date).split("/");
  const template = normalizeRelativePath(settings.template).split("/");
  if ([...note, ...template].some((segment) => UNSAFE_SEGMENT.test(segment))) return "invalidPath";
  // The host creates no file under a hidden name. It reads one, so a template may have it.
  if (note.some((segment) => segment.startsWith("."))) return "hiddenPath";
  return null;
}
