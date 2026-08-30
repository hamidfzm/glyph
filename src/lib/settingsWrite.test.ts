import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { mergeChangedPaths, settingsFromStored } from "./settingsWrite";

// Every window holds its own copy of the settings, so a write that persisted
// that copy whole would undo whatever another window changed meanwhile. These
// pin the merge that keeps both windows' edits, without a provider or a
// debounce in the way.

function stored(overrides: Record<string, unknown>): Partial<Settings> {
  return overrides as Partial<Settings>;
}

describe("settingsFromStored", () => {
  it("falls back to the defaults when nothing is persisted", () => {
    expect(settingsFromStored(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsFromStored(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("layers the stored values over the defaults", () => {
    const result = settingsFromStored(stored({ appearance: { fontSize: 22 } }));
    expect(result.appearance.fontSize).toBe(22);
    expect(result.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
  });

  it("applies legacy migrations", () => {
    const result = settingsFromStored(stored({ layout: { sidebarWidth: 321 } }));
    expect(result.layout.filesSidebarWidth).toBe(321);
    expect(result.layout.outlineSidebarWidth).toBe(321);
  });

  it("is idempotent, so re-running it on every write changes nothing", () => {
    const once = settingsFromStored(stored({ layout: { sidebarWidth: 321 } }));
    expect(settingsFromStored(once)).toEqual(once);
  });
});

describe("mergeChangedPaths", () => {
  const pending = {
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, theme: "dark", fontSize: 20 },
  } as Settings;

  it("re-applies only the paths this window changed", () => {
    // The other window switched the font size after this one loaded.
    const result = mergeChangedPaths(stored({ appearance: { fontSize: 30 } }), pending, [
      "appearance.theme",
    ]);

    expect(result.appearance.theme).toBe("dark");
    expect(result.appearance.fontSize).toBe(30);
  });

  it("keeps a whole branch this window never touched", () => {
    const result = mergeChangedPaths(
      stored({ layout: { filesSidebarVisible: false }, appearance: { fontSize: 30 } }),
      pending,
      ["appearance.theme"],
    );

    expect(result.layout.filesSidebarVisible).toBe(false);
    expect(result.appearance.fontSize).toBe(30);
  });

  it("returns what is on disk when nothing changed", () => {
    const result = mergeChangedPaths(stored({ appearance: { fontSize: 30 } }), pending, []);
    expect(result.appearance.fontSize).toBe(30);
    expect(result.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
  });

  it("merges several changed paths at once", () => {
    const result = mergeChangedPaths(stored({ appearance: { fontSize: 30 } }), pending, [
      "appearance.theme",
      "appearance.fontSize",
    ]);

    expect(result.appearance.theme).toBe("dark");
    expect(result.appearance.fontSize).toBe(20);
  });

  it("ignores a path outside the settings schema", () => {
    // setNestedValue's allowlist rejects it, so the store is left as-is.
    const result = mergeChangedPaths(stored({ appearance: { fontSize: 30 } }), pending, [
      "nonsense.key",
    ]);
    expect(result.appearance.fontSize).toBe(30);
  });

  it("starts from the defaults when nothing is persisted yet", () => {
    const result = mergeChangedPaths(null, pending, ["appearance.theme"]);
    expect(result.appearance.theme).toBe("dark");
    expect(result.appearance.fontSize).toBe(DEFAULT_SETTINGS.appearance.fontSize);
  });
});
