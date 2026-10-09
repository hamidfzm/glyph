import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, readSettings, storedSettings } from "./settings";

describe("readSettings", () => {
  it("uses the defaults when the workspace has stored nothing", () => {
    expect(readSettings({})).toEqual({
      folder: "daily",
      filenamePattern: "YYYY-MM-DD.md",
      template: "",
    });
  });

  it("takes the stored values", () => {
    const stored = { folder: "journal", filenamePattern: "DD.md", template: "templates/day.md" };
    expect(readSettings(stored)).toEqual(stored);
  });

  // An empty folder is the workspace root, a choice and not a missing value.
  it("keeps an empty folder instead of defaulting it", () => {
    expect(readSettings({ folder: "" }).folder).toBe("");
  });

  // The file is hand-editable and travels with a clone.
  it("falls back to the default for a value that is not text", () => {
    const settings = readSettings({ folder: 7, filenamePattern: null, template: ["a.md"] });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe("storedSettings", () => {
  it("stores forward-slash paths and a trimmed pattern", () => {
    const stored = storedSettings({
      folder: "\\journal\\",
      filenamePattern: " YYYY-MM-DD.md ",
      template: "templates\\daily.md",
    });
    expect(stored).toEqual({
      folder: "journal",
      filenamePattern: "YYYY-MM-DD.md",
      template: "templates/daily.md",
    });
  });

  it("stores a blank template as empty", () => {
    expect(storedSettings({ ...DEFAULT_SETTINGS, template: "  " }).template).toBe("");
  });
});
