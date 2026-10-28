import { describe, expect, it } from "vitest";
import { readColorSchemeChoice, resolveColorScheme } from "@/lib/colorSchemeStatus";
import { colorSchemeEntry } from "@/lib/plugins/colorSchemes";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { installed } from "@/test/fixtures/pluginHost";

const CORE = "glyph.core.theme-presets";
const sepia = colorSchemeEntry(CORE, { id: "sepia", label: "Sepia", css: ":root{}" });
const ocean = colorSchemeEntry("com.x.demo", { id: "ocean", label: "Ocean", css: ":root{}" });

const inputs = {
  saved: { id: `${CORE}:sepia`, label: "Sepia" },
  schemes: [sepia],
  initialLoadDone: true,
  corePlugins: DEFAULT_SETTINGS.corePlugins,
  failedCorePlugins: [],
  installed: [installed()],
  disabled: [],
};
const savedOcean = { id: "com.x.demo:ocean", label: "Ocean" };

describe("readColorSchemeChoice", () => {
  it("reads a stored plugin scheme", () => {
    expect(readColorSchemeChoice({ id: `${CORE}:sepia`, label: "Sepia" })).toEqual({
      id: `${CORE}:sepia`,
      label: "Sepia",
    });
  });

  it("names a scheme stored without a label by its id", () => {
    expect(readColorSchemeChoice({ id: "com.x.demo:ocean", label: 3 })).toEqual({
      id: "com.x.demo:ocean",
      label: "com.x.demo:ocean",
    });
  });

  it.each([
    ["the default", { id: "default", label: "" }],
    ["a string", "sepia"],
    ["a number", 42],
    ["null", null],
    ["an array", [`${CORE}:sepia`]],
    ["a non-string id", { id: ["a:b"], label: "x" }],
    ["an id with no plugin part", { id: "sepia", label: "Sepia" }],
    ["a polluted object", JSON.parse('{"__proto__": {"id": "a:b"}}')],
  ])("reads %s as Default", (_, stored) => {
    expect(readColorSchemeChoice(stored)).toEqual(DEFAULT_SETTINGS.appearance.colorScheme);
  });
});

describe("resolveColorScheme", () => {
  it("is default for the app's own palette", () => {
    const saved = DEFAULT_SETTINGS.appearance.colorScheme;
    expect(resolveColorScheme({ ...inputs, saved })).toEqual({ kind: "default" });
  });

  it("is active when a loaded plugin offers the saved scheme", () => {
    expect(resolveColorScheme(inputs)).toEqual({ kind: "active", scheme: sepia });
  });

  it("judges nothing missing before the first plugin load pass", () => {
    const status = resolveColorScheme({
      ...inputs,
      schemes: [],
      initialLoadDone: false,
      corePlugins: { ...inputs.corePlugins, themePresets: false },
    });
    expect(status).toEqual({ kind: "pending" });
  });

  it("is missing when its core plugin is off", () => {
    const corePlugins = { ...inputs.corePlugins, themePresets: false };
    expect(resolveColorScheme({ ...inputs, schemes: [], corePlugins })).toEqual({
      kind: "missing",
      reason: "off",
      provider: { id: CORE, coreKey: "themePresets" },
    });
  });

  it("waits for a core plugin that is on but has registered nothing yet", () => {
    expect(resolveColorScheme({ ...inputs, schemes: [] })).toEqual({ kind: "pending" });
  });

  it("is unavailable when its core plugin is on but failed to load", () => {
    const status = resolveColorScheme({ ...inputs, schemes: [], failedCorePlugins: [CORE] });
    expect(status).toEqual({
      kind: "missing",
      reason: "unavailable",
      provider: { id: CORE, coreKey: "themePresets" },
    });
  });

  it("is unavailable when its core plugin loaded without that scheme", () => {
    const saved = { id: `${CORE}:neon`, label: "Neon" };
    expect(resolveColorScheme({ ...inputs, saved })).toEqual({
      kind: "missing",
      reason: "unavailable",
      provider: { id: CORE, coreKey: "themePresets" },
    });
  });

  it("is missing when its community plugin is turned off", () => {
    const status = resolveColorScheme({
      ...inputs,
      saved: savedOcean,
      disabled: ["com.x.demo"],
    });
    expect(status).toEqual({
      kind: "missing",
      reason: "disabled",
      provider: { id: "com.x.demo", name: "Demo" },
    });
  });

  it("is missing when its plugin is not installed", () => {
    const status = resolveColorScheme({ ...inputs, saved: savedOcean, installed: [] });
    expect(status).toEqual({
      kind: "missing",
      reason: "notInstalled",
      provider: { id: "com.x.demo" },
    });
  });

  it("is unavailable when its community plugin is on but offers no such scheme", () => {
    expect(resolveColorScheme({ ...inputs, saved: savedOcean })).toEqual({
      kind: "missing",
      reason: "unavailable",
      provider: { id: "com.x.demo", name: "Demo" },
    });
  });

  it("applies a community scheme its plugin offers", () => {
    const status = resolveColorScheme({ ...inputs, saved: savedOcean, schemes: [sepia, ocean] });
    expect(status).toEqual({ kind: "active", scheme: ocean });
  });
});
