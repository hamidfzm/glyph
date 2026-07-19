import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { HotkeysTab } from "./HotkeysTab";

function setup(overrides: Record<string, string> = {}) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    keybindings: { overrides },
  };
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings,
    updateSettings,
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  render(<HotkeysTab />, { wrapper });
  return { updateSettings };
}

describe("HotkeysTab", () => {
  it("lists bindable commands grouped by category", () => {
    setup();
    expect(screen.getByText("Open File")).toBeInTheDocument();
    expect(screen.getByText("Command Palette")).toBeInTheDocument();
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
  });

  it("filters the list to commands matching the search query", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Search shortcuts"), { target: { value: "palette" } });
    expect(screen.getByText("Command Palette")).toBeInTheDocument();
    expect(screen.queryByText("Open File")).toBeNull();
    expect(screen.queryByText("File")).toBeNull();
  });

  it("shows nothing when the query matches no command", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Search shortcuts"), { target: { value: "zzzzz" } });
    expect(screen.queryByText("Open File")).toBeNull();
    expect(screen.queryByText("View")).toBeNull();
  });

  it("records a new shortcut and writes it to the overrides", () => {
    const { updateSettings } = setup();
    fireEvent.click(screen.getByLabelText("Change shortcut for Open File"));
    fireEvent.keyDown(document, { code: "KeyG", ctrlKey: true });
    expect(updateSettings).toHaveBeenCalledWith("keybindings.overrides", { open: "CmdOrCtrl+G" });
  });

  it("ignores a bare key with no modifier while recording", () => {
    const { updateSettings } = setup();
    fireEvent.click(screen.getByLabelText("Change shortcut for Open File"));
    fireEvent.keyDown(document, { code: "KeyG" });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("cancels recording on Escape without writing an override", () => {
    const { updateSettings } = setup();
    fireEvent.click(screen.getByLabelText("Change shortcut for Open File"));
    expect(screen.getByLabelText("Recording shortcut for Open File")).toBeInTheDocument();
    fireEvent.keyDown(document, { code: "Escape" });
    expect(updateSettings).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Change shortcut for Open File")).toBeInTheDocument();
  });

  it("ignores a modifier combined with an unmappable key while recording", () => {
    const { updateSettings } = setup();
    fireEvent.click(screen.getByLabelText("Change shortcut for Open File"));
    fireEvent.keyDown(document, { code: "F13", ctrlKey: true });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("resets an overridden binding by removing its key", () => {
    const { updateSettings } = setup({ open: "CmdOrCtrl+G" });
    fireEvent.click(screen.getByLabelText("Reset shortcut for Open File"));
    expect(updateSettings).toHaveBeenCalledWith("keybindings.overrides", {});
  });

  it("flags both sides of a conflict", () => {
    setup({ "open-folder": "CmdOrCtrl+O" });
    expect(screen.getAllByText("Conflicts with another shortcut")).toHaveLength(2);
  });
});
