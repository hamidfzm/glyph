import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { EditorTab } from "./EditorTab";

function setup(settings: Settings = DEFAULT_SETTINGS) {
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings,
    updateSettings,
    resetSettings: vi.fn(),
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  render(<EditorTab />, { wrapper });
  return { updateSettings };
}

describe("EditorTab", () => {
  it("offers the keymap presets", () => {
    setup();
    expect(screen.getByText("Keymap")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Vim")).toBeInTheDocument();
    expect(screen.getByText("VSCode")).toBeInTheDocument();
  });

  it("updates the keymap when a preset is chosen", () => {
    const { updateSettings } = setup();
    fireEvent.click(screen.getByText("Vim"));
    expect(updateSettings).toHaveBeenCalledWith("editor.keymap", "vim");
  });

  it("shows the Default quick reference for the default keymap", () => {
    setup();
    expect(screen.getByText("Default (Glyph) shortcuts")).toBeInTheDocument();
    expect(screen.queryByText("Vim quick reference")).toBeNull();
  });

  it("shows the Vim quick reference when Vim is selected", () => {
    setup({ ...DEFAULT_SETTINGS, editor: { keymap: "vim" } });
    expect(screen.getByText("Vim quick reference")).toBeInTheDocument();
  });

  it("shows the VSCode quick reference when VSCode is selected", () => {
    setup({ ...DEFAULT_SETTINGS, editor: { keymap: "vscode" } });
    expect(screen.getByText("VSCode shortcuts")).toBeInTheDocument();
  });
});
