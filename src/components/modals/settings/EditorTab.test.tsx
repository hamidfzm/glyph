import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import {
  clearDictionarySources,
  registerDictionarySource,
} from "@/lib/spellcheck/dictionarySources";
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
  beforeEach(() => {
    clearDictionarySources();
  });

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
    setup({ ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, keymap: "vim" } });
    expect(screen.getByText("Vim quick reference")).toBeInTheDocument();
  });

  it("shows the VSCode quick reference when VSCode is selected", () => {
    setup({ ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, keymap: "vscode" } });
    expect(screen.getByText("VSCode shortcuts")).toBeInTheDocument();
  });

  it("toggles spell check", () => {
    const { updateSettings } = setup();
    expect(screen.getByText("Check spelling")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(updateSettings).toHaveBeenCalledWith("editor.spellCheck", true);
  });

  it("shows the language list only when spell check is on", () => {
    setup();
    expect(screen.queryByText("Languages")).toBeNull();

    setup({ ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, spellCheck: true } });
    expect(screen.getByText("Languages")).toBeInTheDocument();
    expect(screen.getByText("English (US)")).toBeInTheDocument();
  });

  it("enabling a plugin language appends it to the enabled set", () => {
    registerDictionarySource({
      language: "fa",
      label: "فارسی (Persian)",
      load: () => Promise.resolve({ aff: "", dic: "" }),
    });
    const { updateSettings } = setup({
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_SETTINGS.editor, spellCheck: true },
    });

    const persianRow = screen.getByText("فارسی (Persian)").closest(".settings-row");
    expect(persianRow).not.toBeNull();
    fireEvent.click(within(persianRow as HTMLElement).getByRole("checkbox"));
    expect(updateSettings).toHaveBeenCalledWith("editor.spellCheckLanguages", ["en", "fa"]);
  });

  it("disabling a language removes it from the enabled set", () => {
    const { updateSettings } = setup({
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_SETTINGS.editor, spellCheck: true, spellCheckLanguages: ["en"] },
    });
    const englishRow = screen.getByText("English (US)").closest(".settings-row");
    const toggle = within(englishRow as HTMLElement).getByRole("checkbox");
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith("editor.spellCheckLanguages", []);
  });

  it("a plugin dictionary for en replaces the built-in entry", () => {
    registerDictionarySource({
      language: "en",
      label: "English (custom)",
      load: () => Promise.resolve({ aff: "", dic: "" }),
    });
    setup({ ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, spellCheck: true } });

    expect(screen.getByText("English (custom)")).toBeInTheDocument();
    expect(screen.queryByText("English (US)")).toBeNull();
  });

  it("keeps an orphaned enabled language listed so it can be turned off", () => {
    const { updateSettings } = setup({
      ...DEFAULT_SETTINGS,
      editor: {
        ...DEFAULT_SETTINGS.editor,
        spellCheck: true,
        spellCheckLanguages: ["en", "fa"],
      },
    });
    const orphanRow = screen.getByText("fa").closest(".settings-row");
    const toggle = within(orphanRow as HTMLElement).getByRole("checkbox");
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith("editor.spellCheckLanguages", ["en"]);
  });
});
