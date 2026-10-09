import { describe, expect, it } from "vitest";
import {
  dailyNoteName,
  dailyNotePath,
  dailyNotesProblem,
  formatDatePattern,
  normalizeRelativePath,
} from "./notePath";
import { DEFAULT_SETTINGS } from "./settings";

// Local time, like the "today" the plugin passes in.
const OCT_8 = new Date(2026, 9, 8);
const MAR_5 = new Date(2031, 2, 5);

describe("formatDatePattern", () => {
  it("fills the padded tokens", () => {
    expect(formatDatePattern("YYYY-MM-DD", OCT_8)).toBe("2026-10-08");
    expect(formatDatePattern("YYYY-MM-DD", MAR_5)).toBe("2031-03-05");
  });

  it("fills the short tokens without padding", () => {
    expect(formatDatePattern("D.M.YY", MAR_5)).toBe("5.3.31");
    expect(formatDatePattern("D.M.YY", OCT_8)).toBe("8.10.26");
  });

  it("pads a two-digit year below ten", () => {
    expect(formatDatePattern("YY", new Date(2005, 0, 1))).toBe("05");
  });

  it("keeps bracketed text as written, tokens included", () => {
    expect(formatDatePattern("[Daily] YYYY", OCT_8)).toBe("Daily 2026");
    expect(formatDatePattern("[MM]MM[]", OCT_8)).toBe("MM10");
  });

  it("leaves text that is not a token alone", () => {
    expect(formatDatePattern("notes for the day", OCT_8)).toBe("notes for the day");
  });
});

describe("dailyNoteName", () => {
  it("formats the default pattern as an ISO date", () => {
    expect(dailyNoteName("YYYY-MM-DD.md", OCT_8)).toBe("2026-10-08.md");
  });

  it("adds .md when the pattern does not end in it", () => {
    expect(dailyNoteName("YYYY-MM-DD", OCT_8)).toBe("2026-10-08.md");
    expect(dailyNoteName("YYYY.MM.DD", OCT_8)).toBe("2026.10.08.md");
    expect(dailyNoteName("YYYY-MM-DD.txt", OCT_8)).toBe("2026-10-08.txt.md");
  });

  it("never reads the extension's letters as tokens", () => {
    expect(dailyNoteName("YYYY-MM-DD.MD", OCT_8)).toBe("2026-10-08.MD");
  });

  it("ignores whitespace around the pattern", () => {
    expect(dailyNoteName("  YYYY-MM-DD.md ", OCT_8)).toBe("2026-10-08.md");
  });
});

describe("normalizeRelativePath", () => {
  it("accepts either separator and drops empty and dot segments", () => {
    expect(normalizeRelativePath("\\journal\\2026/")).toBe("journal/2026");
    expect(normalizeRelativePath("./a//b/./c")).toBe("a/b/c");
    expect(normalizeRelativePath(" a / b ")).toBe("a/b");
    expect(normalizeRelativePath("")).toBe("");
  });

  it("keeps a parent segment for the validator to refuse", () => {
    expect(normalizeRelativePath("a/../b")).toBe("a/../b");
  });
});

describe("dailyNotePath", () => {
  it("joins the folder and the day's file name", () => {
    expect(dailyNotePath(DEFAULT_SETTINGS, OCT_8)).toBe("daily/2026-10-08.md");
  });

  it("puts the note at the workspace root for an empty folder", () => {
    expect(dailyNotePath({ ...DEFAULT_SETTINGS, folder: "" }, OCT_8)).toBe("2026-10-08.md");
  });

  it("lets the pattern nest notes in dated folders", () => {
    const settings = { ...DEFAULT_SETTINGS, folder: "journal/", filenamePattern: "YYYY/MM/DD.md" };
    expect(dailyNotePath(settings, OCT_8)).toBe("journal/2026/10/08.md");
  });
});

describe("dailyNotesProblem", () => {
  it("accepts the defaults and a template inside the workspace", () => {
    expect(dailyNotesProblem(DEFAULT_SETTINGS, OCT_8)).toBeNull();
    const withTemplate = { ...DEFAULT_SETTINGS, template: "templates/daily.md" };
    expect(dailyNotesProblem(withTemplate, OCT_8)).toBeNull();
  });

  it("requires a file name pattern", () => {
    expect(dailyNotesProblem({ ...DEFAULT_SETTINGS, filenamePattern: "  " }, OCT_8)).toBe(
      "patternRequired",
    );
  });

  it.each([
    ["a folder", { ...DEFAULT_SETTINGS, folder: "../outside" }],
    ["a pattern", { ...DEFAULT_SETTINGS, filenamePattern: "../YYYY-MM-DD.md" }],
    ["a template", { ...DEFAULT_SETTINGS, template: "templates/../../secret.md" }],
  ])("refuses %s that climbs out of the workspace", (_name, settings) => {
    expect(dailyNotesProblem(settings, OCT_8)).toBe("invalidPath");
  });

  it("refuses characters a file name cannot have on every platform", () => {
    expect(dailyNotesProblem({ ...DEFAULT_SETTINGS, folder: "C:\\notes" }, OCT_8)).toBe(
      "invalidPath",
    );
    expect(dailyNotesProblem({ ...DEFAULT_SETTINGS, filenamePattern: "YYYY?.md" }, OCT_8)).toBe(
      "invalidPath",
    );
    expect(dailyNotesProblem({ ...DEFAULT_SETTINGS, template: "what*.md" }, OCT_8)).toBe(
      "invalidPath",
    );
  });

  it("allows dots that are not a parent segment", () => {
    const settings = { ...DEFAULT_SETTINGS, filenamePattern: "YYYY..MM.md" };
    expect(dailyNotesProblem(settings, OCT_8)).toBeNull();
  });
});
