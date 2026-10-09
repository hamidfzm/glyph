import { act, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CommandContribution,
  Disposer,
  GlyphPluginContext,
  WorkspaceSettingsPanelContribution,
} from "@/lib/plugins/types";
import plugin from "./dailyNotesPlugin";

function fakeContext() {
  const fire = { languageChange: () => {} };
  const disposers: Array<ReturnType<typeof vi.fn>> = [];
  const tracked = () => {
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  };
  const ctx = {
    registerTranslations: vi.fn(),
    i18n: {
      t: vi.fn((key: string) => key),
      onLanguageChange: vi.fn((listener: () => void) => {
        fire.languageChange = listener;
        return vi.fn();
      }),
    },
    commands: { register: vi.fn((_command: CommandContribution) => tracked()) },
    ui: {
      addWorkspaceSettingsPanel: vi.fn((_panel: WorkspaceSettingsPanelContribution) => tracked()),
    },
    workspace: {
      getRoot: vi.fn(() => "/ws"),
      getSettings: vi.fn(async () => ({ folder: "journal" })),
      setSettings: vi.fn(async () => {}),
      readFile: vi.fn(async () => ""),
      createFile: vi.fn(async () => ({ path: "/ws/journal/today.md", created: true })),
    },
    navigation: { openFile: vi.fn() },
    notify: vi.fn(),
  };
  return { ctx, fire, disposers };
}

async function activate() {
  const fake = fakeContext();
  await plugin.activate(fake.ctx as unknown as GlyphPluginContext);
  return {
    ...fake,
    command: fake.ctx.commands.register.mock.calls[0][0],
    panel: fake.ctx.ui.addWorkspaceSettingsPanel.mock.calls[0][0],
  };
}

/** Every key path in a locale bundle, so nested sections are compared too. */
function keyPaths(resources: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(resources).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? keyPaths(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const cleanups: Disposer[] = [];

// Cleanup empties the plugin's React root, an update that has to land inside act.
afterEach(() => {
  act(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  document.body.innerHTML = "";
});

describe("Daily notes core plugin", () => {
  it("ships every string in all five locales", async () => {
    const { ctx } = await activate();
    const calls = ctx.registerTranslations.mock.calls;
    expect(calls.map(([locale, namespace]) => [locale, namespace])).toEqual([
      ["en", "glyph.core.daily-notes"],
      ["de", "glyph.core.daily-notes"],
      ["es", "glyph.core.daily-notes"],
      ["fa", "glyph.core.daily-notes"],
      ["zh", "glyph.core.daily-notes"],
    ]);
    const paths = calls.map(([, , resources]) => keyPaths(resources).sort());
    expect(paths[0].length).toBeGreaterThan(10);
    for (const locale of paths) expect(locale).toEqual(paths[0]);
  });

  it("adds a File menu command with a shortcut, offered only in a workspace", async () => {
    const { command } = await activate();
    expect(command).toEqual({
      id: "open-today",
      title: "glyph.core.daily-notes:command",
      menu: "file",
      shortcut: "CmdOrCtrl+Shift+T",
      when: "workspace",
      run: expect.any(Function),
    });
  });

  it("runs the command against the workspace's own settings", async () => {
    const { ctx, command } = await activate();

    await command.run();

    expect(ctx.workspace.createFile).toHaveBeenCalledWith(
      expect.stringMatching(/^journal\/\d{4}-\d{2}-\d{2}\.md$/),
      "",
    );
    expect(ctx.navigation.openFile).toHaveBeenCalledWith("/ws/journal/today.md");
  });

  it("adds a Workspace Settings tab that loads and saves the workspace's settings", async () => {
    const { ctx, panel } = await activate();
    expect(panel).toMatchObject({ id: "settings", title: "glyph.core.daily-notes:settings.title" });

    const el = document.createElement("div");
    document.body.append(el);
    act(() => panel.mount(el, (cleanup) => cleanups.push(cleanup)));
    const folder = await within(el).findByRole("textbox", { name: /settings\.folder\.label/ });
    expect(folder).toHaveValue("journal");

    await act(async () => {
      within(el)
        .getByRole("button", { name: /settings\.save/ })
        .click();
    });
    expect(ctx.workspace.setSettings).toHaveBeenCalledWith({
      folder: "journal",
      filenamePattern: "YYYY-MM-DD.md",
      template: "",
    });
  });

  it("adds the command and the tab again on a language switch, with the new strings", async () => {
    const { ctx, fire, disposers } = await activate();
    ctx.i18n.t.mockImplementation((key) => `fa ${key}`);

    fire.languageChange();

    expect(disposers[0]).toHaveBeenCalledOnce();
    expect(disposers[1]).toHaveBeenCalledOnce();
    expect(ctx.commands.register.mock.calls[1][0].title).toBe("fa glyph.core.daily-notes:command");
    expect(ctx.ui.addWorkspaceSettingsPanel.mock.calls[1][0].title).toBe(
      "fa glyph.core.daily-notes:settings.title",
    );

    // The next switch removes what the previous switch added, not the first pair again.
    fire.languageChange();
    expect(disposers[0]).toHaveBeenCalledOnce();
    expect(disposers[2]).toHaveBeenCalledOnce();
    expect(disposers[3]).toHaveBeenCalledOnce();
    expect(ctx.commands.register).toHaveBeenCalledTimes(3);
  });
});
