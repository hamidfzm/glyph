import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

vi.mock("@/contexts/TabsContext", () => ({ useWorkspaceRoot: () => undefined }));

const { buildSpellcheck } = vi.hoisted(() => ({ buildSpellcheck: vi.fn(() => []) }));
vi.mock("@/lib/spellcheck/spellcheckExtension", () => ({ buildSpellcheck }));

import { MarkdownEditor } from "./MarkdownEditor";

function settingsWith(spellCheck: boolean, spellCheckLanguages: string[] = ["en"]): Settings {
  return {
    ...DEFAULT_SETTINGS,
    editor: { ...DEFAULT_SETTINGS.editor, spellCheck, spellCheckLanguages },
  };
}

function wrapper(settings: Settings) {
  const value: SettingsContextValue = {
    settings,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    loaded: true,
  };
  return ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

afterEach(() => {
  buildSpellcheck.mockClear();
});

describe("MarkdownEditor spell-check wiring", () => {
  it("builds the spell-check extension for the enabled languages", () => {
    render(<MarkdownEditor content="helo world" onChange={() => {}} />, {
      wrapper: wrapper(settingsWith(true, ["en", "fa"])),
    });
    expect(buildSpellcheck).toHaveBeenCalledWith(["en", "fa"], expect.any(Function));
  });

  it("does not build the spell-check extension when disabled", () => {
    render(<MarkdownEditor content="helo world" onChange={() => {}} />, {
      wrapper: wrapper(settingsWith(false)),
    });
    expect(buildSpellcheck).not.toHaveBeenCalled();
  });

  it("reconfigures spell check in place when the setting toggles on", () => {
    const tree = (settings: Settings) => (
      <SettingsContext.Provider
        value={{ settings, updateSettings: vi.fn(), resetSettings: vi.fn(), loaded: true }}
      >
        <MarkdownEditor content="helo world" onChange={() => {}} />
      </SettingsContext.Provider>
    );
    const { rerender } = render(tree(settingsWith(false)));
    expect(buildSpellcheck).not.toHaveBeenCalled();

    // Same editor instance, spell check flipped on: the reconfigure effect runs
    // without a remount (mount effect is keyed on keymap only).
    rerender(tree(settingsWith(true)));
    expect(buildSpellcheck).toHaveBeenCalledWith(["en"], expect.any(Function));
  });

  it("reconfigures when the enabled language set changes", () => {
    const tree = (settings: Settings) => (
      <SettingsContext.Provider
        value={{ settings, updateSettings: vi.fn(), resetSettings: vi.fn(), loaded: true }}
      >
        <MarkdownEditor content="helo world" onChange={() => {}} />
      </SettingsContext.Provider>
    );
    const { rerender } = render(tree(settingsWith(true, ["en"])));
    buildSpellcheck.mockClear();

    // A fresh array with the same contents must not reconfigure...
    rerender(tree(settingsWith(true, ["en"])));
    expect(buildSpellcheck).not.toHaveBeenCalled();

    // ...but a real set change must.
    rerender(tree(settingsWith(true, ["en", "fa"])));
    expect(buildSpellcheck).toHaveBeenCalledWith(["en", "fa"], expect.any(Function));
  });
});
