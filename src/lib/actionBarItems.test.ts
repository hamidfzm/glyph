import { describe, expect, it, vi } from "vitest";
import { type ActionBarOptions, actionBarItems } from "./actionBarItems";

function options(overrides: Partial<ActionBarOptions> = {}): ActionBarOptions {
  return { openPalette: vi.fn(), openGraph: vi.fn(), hasWorkspace: true, ...overrides };
}

describe("actionBarItems", () => {
  it("offers the palette and the graph when a workspace is open", () => {
    expect(actionBarItems(options()).map((i) => i.id)).toEqual(["commandPalette", "openGraph"]);
  });

  it("drops the graph without a workspace, where opening it would do nothing", () => {
    const items = actionBarItems(options({ hasWorkspace: false }));
    expect(items.map((i) => i.id)).toEqual(["commandPalette"]);
  });

  it("runs the callback it was given", () => {
    const openPalette = vi.fn();
    const openGraph = vi.fn();

    for (const item of actionBarItems(options({ openPalette, openGraph }))) item.run();
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(openGraph).toHaveBeenCalledTimes(1);
  });

  it("carries a label key and an icon for every item", () => {
    for (const item of actionBarItems(options())) {
      expect(item.labelKey).toMatch(/^tabBar\./);
      expect(item.Icon).toBeTypeOf("function");
    }
  });
});
