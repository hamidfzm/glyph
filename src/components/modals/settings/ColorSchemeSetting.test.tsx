import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { colorSchemeHarness } from "@/test/colorSchemeHarness";
import { ColorSchemeSetting } from "./ColorSchemeSetting";

const defaultProps = { onOpenPlugins: vi.fn() };
const SEPIA = { id: "glyph.core.theme-presets:sepia", label: "Sepia" };

const picker = () => screen.getByRole<HTMLSelectElement>("combobox", { name: "Color Scheme" });
const options = () =>
  within(picker())
    .getAllByRole<HTMLOptionElement>("option")
    .map((option) => [option.textContent, option.disabled]);

describe("ColorSchemeSetting", () => {
  it("lists Default, then every scheme a loaded plugin offers", () => {
    const { wrapper, offer } = colorSchemeHarness();
    offer("glyph.core.theme-presets", "sepia", "Sepia");
    offer("com.x.demo", "ocean", "Ocean");
    render(<ColorSchemeSetting {...defaultProps} />, { wrapper });

    expect(picker().value).toBe("default");
    expect(options()).toEqual([
      ["Default", false],
      ["Sepia", false],
      ["Ocean", false],
    ]);
  });

  it("stores the picked scheme with its label, and Default as the default", () => {
    const { wrapper, offer, updateSettings } = colorSchemeHarness({ saved: SEPIA });
    offer("glyph.core.theme-presets", "sepia", "Sepia");
    offer("com.x.demo", "ocean", "Ocean");
    render(<ColorSchemeSetting {...defaultProps} />, { wrapper });
    expect(picker().value).toBe(SEPIA.id);

    fireEvent.change(picker(), { target: { value: "com.x.demo:ocean" } });
    expect(updateSettings).toHaveBeenLastCalledWith("appearance.colorScheme", {
      id: "com.x.demo:ocean",
      label: "Ocean",
    });

    fireEvent.change(picker(), { target: { value: "default" } });
    expect(updateSettings).toHaveBeenLastCalledWith(
      "appearance.colorScheme",
      DEFAULT_SETTINGS.appearance.colorScheme,
    );
  });

  it("keeps a missing scheme selected as unavailable, and explains why", () => {
    const { wrapper } = colorSchemeHarness({ saved: SEPIA, corePlugins: { themePresets: false } });
    render(<ColorSchemeSetting {...defaultProps} />, { wrapper });

    expect(picker().value).toBe(SEPIA.id);
    expect(options()).toEqual([
      ["Default", false],
      ["Sepia (unavailable)", true],
    ]);
    expect(screen.getByText(/Sepia comes from Theme presets, which is turned off/)).toBeTruthy();
  });

  it("claims nothing unavailable while plugins are still loading", () => {
    const { wrapper } = colorSchemeHarness({
      saved: SEPIA,
      corePlugins: { themePresets: false },
      plugins: { initialLoadDone: false },
    });
    render(<ColorSchemeSetting {...defaultProps} />, { wrapper });

    expect(picker().value).toBe(SEPIA.id);
    expect(options()).toEqual([
      ["Default", false],
      ["Sepia", true],
    ]);
    expect(screen.queryByText(/comes from/)).toBeNull();
  });

  it("shows the scheme as unavailable when its core plugin failed to load", () => {
    const { wrapper } = colorSchemeHarness({
      saved: SEPIA,
      plugins: { failedCorePlugins: ["glyph.core.theme-presets"] },
    });
    render(<ColorSchemeSetting {...defaultProps} />, { wrapper });

    expect(options()).toEqual([
      ["Default", false],
      ["Sepia (unavailable)", true],
    ]);
    expect(screen.getByText(/isn't offering Sepia right now/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Plugins" })).toBeTruthy();
  });

  it("opens the Plugins tab from Manage", () => {
    const onOpenPlugins = vi.fn();
    const { wrapper } = colorSchemeHarness();
    render(<ColorSchemeSetting {...defaultProps} onOpenPlugins={onOpenPlugins} />, { wrapper });

    expect(screen.getByText("More color schemes come from plugins.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(onOpenPlugins).toHaveBeenCalledOnce();
  });
});
