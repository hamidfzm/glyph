import { describe, expect, it } from "vitest";
import { colorSchemeEntry, colorSchemePluginId, uniqueColorSchemes } from "./colorSchemes";
import type { ColorSchemeContribution } from "./types";

describe("colorSchemeEntry", () => {
  it("keys a scheme by its plugin", () => {
    expect(colorSchemeEntry("com.x.demo", { id: "ocean", label: "Ocean", css: ":root{}" })).toEqual(
      {
        pluginId: "com.x.demo",
        key: "com.x.demo:ocean",
        id: "ocean",
        label: "Ocean",
        css: ":root{}",
      },
    );
  });

  it.each([
    ["no scheme", null],
    ["an empty id", { id: "", label: "Ocean", css: "" }],
    ["a number id", { id: 7, label: "Ocean", css: "" }],
    ["no label", { id: "ocean", css: "" }],
    ["css that is not a string", { id: "ocean", label: "Ocean", css: { color: "red" } }],
  ])("refuses %s", (_, scheme) => {
    expect(() =>
      colorSchemeEntry("com.x.demo", scheme as unknown as ColorSchemeContribution),
    ).toThrow("a color scheme needs a non-empty id and label");
  });
});

describe("colorSchemePluginId", () => {
  it("reads the plugin part of a key", () => {
    expect(colorSchemePluginId("glyph.core.theme-presets:sepia")).toBe("glyph.core.theme-presets");
    expect(colorSchemePluginId("com.x.demo:a:b")).toBe("com.x.demo");
  });

  it("is empty for a key with no plugin part", () => {
    expect(colorSchemePluginId("default")).toBe("");
    expect(colorSchemePluginId(":sepia")).toBe("");
  });
});

describe("uniqueColorSchemes", () => {
  it("keeps the newest entry for a key", () => {
    const entry = (id: string, label: string) => colorSchemeEntry("p", { id, label, css: "" });
    const old = entry("ocean", "Ocean");
    const reef = entry("reef", "Reef");
    const renamed = entry("ocean", "Ozean");

    expect(uniqueColorSchemes([old, reef, renamed])).toEqual([reef, renamed]);
  });
});
