import { render } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { i18n } from "@/lib/i18n";
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

function settingsWithKeymap(keymap: Settings["editor"]["keymap"]): Settings {
  return { ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, spellCheck: false, keymap } };
}

function wrapper(settings: Settings) {
  const value: SettingsContextValue = {
    settings,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
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
        value={{
          settings,
          updateSettings: vi.fn(),
          resetSettings: vi.fn(),
          flushSettings: async () => true,
          loaded: true,
        }}
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
        value={{
          settings,
          updateSettings: vi.fn(),
          resetSettings: vi.fn(),
          flushSettings: async () => true,
          loaded: true,
        }}
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

describe("MarkdownEditor external content sync", () => {
  const doc = (container: HTMLElement) => container.querySelector(".cm-content")?.textContent;

  it("pushes a new content prop into the document without reporting it back", () => {
    // The prop is the caller's own text, so echoing it through onChange makes
    // the editor and the caller's state chase each other: React counts the
    // nested updates and throws "Maximum update depth exceeded".
    const onChange = vi.fn();
    const tree = (content: string) => <MarkdownEditor content={content} onChange={onChange} />;
    const { container, rerender } = render(tree("first"), {
      wrapper: wrapper(settingsWith(false)),
    });

    act(() => rerender(tree("second")));

    expect(doc(container)).toBe("second");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MarkdownEditor find and replace", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  function renderEditor(searchOpen: boolean, onSearchClose = vi.fn()) {
    const tree = (open: boolean) => (
      <MarkdownEditor
        content="cat cat"
        onChange={() => {}}
        searchOpen={open}
        onSearchClose={onSearchClose}
      />
    );
    const view = render(tree(searchOpen), { wrapper: wrapper(settingsWith(false)) });
    return { ...view, setOpen: (open: boolean) => view.rerender(tree(open)) };
  }

  const panel = (container: HTMLElement) => container.querySelector(".cm-panel.cm-search");

  it("keeps the panel closed until search is opened", () => {
    const { container } = renderEditor(false);
    expect(panel(container)).toBeNull();
  });

  it("opens the panel with find and replace fields when search opens", () => {
    const { container, setOpen } = renderEditor(false);
    act(() => setOpen(true));

    const found = panel(container);
    expect(found).not.toBeNull();
    expect(found?.querySelector("input[main-field]")).not.toBeNull();
    expect(found?.querySelector("button[name=replace]")).not.toBeNull();
    expect(found?.querySelector("button[name=replaceAll]")).not.toBeNull();
  });

  it("closes the panel again when search closes", () => {
    const { container, setOpen } = renderEditor(true);
    expect(panel(container)).not.toBeNull();

    act(() => setOpen(false));
    expect(panel(container)).toBeNull();
  });

  it("reports back when the panel is dismissed from inside", () => {
    const onSearchClose = vi.fn();
    const { container } = renderEditor(true, onSearchClose);

    act(() => {
      container.querySelector<HTMLButtonElement>(".cm-panel.cm-search button[name=close]")?.click();
    });
    expect(onSearchClose).toHaveBeenCalled();
  });

  // A keymap change rebuilds the EditorView, which drops the panel; the parent
  // still believes search is open, so the panel has to be restored or Find
  // becomes a permanent no-op for that tab.
  it("restores the panel after a keymap change rebuilds the editor", () => {
    const tree = (settings: Settings) => (
      <SettingsContext.Provider
        value={{
          settings,
          updateSettings: vi.fn(),
          resetSettings: vi.fn(),
          flushSettings: async () => true,
          loaded: true,
        }}
      >
        <MarkdownEditor content="cat cat" onChange={() => {}} searchOpen onSearchClose={vi.fn()} />
      </SettingsContext.Provider>
    );
    const { container, rerender } = render(tree(settingsWithKeymap("default")));
    expect(panel(container)).not.toBeNull();

    act(() => rerender(tree(settingsWithKeymap("vscode"))));
    expect(panel(container)).not.toBeNull();
  });

  it("labels the panel in the active locale", async () => {
    const { container } = renderEditor(true);
    expect(container.querySelector<HTMLInputElement>("input[main-field]")?.placeholder).toBe(
      "Find",
    );

    // Reconfigured in place: the panel is relabelled without remounting.
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(container.querySelector<HTMLInputElement>("input[main-field]")?.placeholder).toBe(
      "Suchen",
    );
  });
});
