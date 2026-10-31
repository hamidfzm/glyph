import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { colorSchemeHarness } from "@/test/colorSchemeHarness";
import { ColorSchemeNote } from "./ColorSchemeNote";

type NoteProps = ComponentProps<typeof ColorSchemeNote>;

const defaultProps: NoteProps = {
  scheme: "Ocean",
  reason: "disabled",
  provider: { id: "com.x.ocean", name: "Ocean Pack" },
  onOpenPlugins: vi.fn(),
};

function renderNote(props: Partial<NoteProps> = {}) {
  const harness = colorSchemeHarness();
  render(<ColorSchemeNote {...defaultProps} {...props} />, { wrapper: harness.wrapper });
  return harness;
}

describe("ColorSchemeNote", () => {
  it("turns a core plugin that is off back on in place", () => {
    const { updateSettings } = renderNote({
      scheme: "Sepia",
      reason: "off",
      provider: { id: "glyph.core.theme-presets", coreKey: "themePresets" },
    });

    expect(
      screen.getByText(
        /Sepia comes from Theme presets, which is turned off\. Glyph is using the default colors\./,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(updateSettings).toHaveBeenCalledWith("corePlugins.themePresets", true);
  });

  it("opens the Plugins tab for a community plugin that is turned off", () => {
    const onOpenPlugins = vi.fn();
    renderNote({ onOpenPlugins });

    expect(screen.getByText(/Ocean comes from Ocean Pack, which is turned off/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Plugins" }));
    expect(onOpenPlugins).toHaveBeenCalledOnce();
  });

  it("names a plugin that is not installed by its id, with nothing to click", () => {
    renderNote({ reason: "notInstalled", provider: { id: "com.x.ocean" } });

    expect(screen.getByText(/Ocean comes from com\.x\.ocean, which isn't installed/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("points to the Plugins tab when a loaded plugin does not offer the scheme", () => {
    renderNote({ reason: "unavailable" });

    expect(screen.getByText(/Ocean Pack isn't offering Ocean right now/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Plugins" })).toBeTruthy();
  });
});
