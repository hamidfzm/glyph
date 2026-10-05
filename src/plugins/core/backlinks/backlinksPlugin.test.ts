import { act, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Backlink,
  Disposer,
  GlyphPluginContext,
  SidebarPanelContribution,
} from "@/lib/plugins/types";
import plugin from "./backlinksPlugin";

const rows: Backlink[] = [
  { source: "/workspace/Index.md", line: 4, snippet: "see [[Cooking]]" },
  { source: "/workspace/Notes/Travel.md", line: 12, snippet: "ref to [[Cooking]] here" },
];

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeContext(initialRows: Backlink[]) {
  const fire = { languageChange: () => {}, vaultChange: () => {} };
  const panelDisposers: Array<ReturnType<typeof vi.fn>> = [];
  const ctx = {
    registerTranslations: vi.fn(),
    i18n: {
      t: vi.fn((key: string) => key),
      onLanguageChange: vi.fn((listener: () => void) => {
        fire.languageChange = listener;
        return vi.fn();
      }),
    },
    ui: {
      addSidebarPanel: vi.fn((_panel: SidebarPanelContribution) => {
        const dispose = vi.fn();
        panelDisposers.push(dispose);
        return dispose;
      }),
    },
    navigation: { openFile: vi.fn() },
    documents: {
      getActive: vi.fn(() => ({ path: "/workspace/Cooking.md", text: null, selection: "" })),
      onActiveChange: vi.fn(() => vi.fn()),
    },
    vault: {
      backlinks: vi.fn(async () => initialRows),
      onChange: vi.fn((listener: () => void) => {
        fire.vaultChange = listener;
        return vi.fn();
      }),
    },
    workspace: { getRoot: vi.fn(() => "/workspace"), onChange: vi.fn(() => vi.fn()) },
  };
  return { ctx, fire, panelDisposers };
}

/** Activate the plugin and wait for the first rows; returns the panel it added. */
async function activate(initialRows = rows) {
  const fake = fakeContext(initialRows);
  await plugin.activate(fake.ctx as unknown as GlyphPluginContext);
  await flushMicrotasks();
  return { ...fake, panel: fake.ctx.ui.addSidebarPanel.mock.calls[0][0] };
}

const cleanups: Disposer[] = [];
const registerCleanup = (cleanup: Disposer) => {
  cleanups.push(cleanup);
};

function mountPoint(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

// Cleanup empties the plugin's React root, an update that has to land inside act.
function runCleanups(): void {
  act(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
}

afterEach(() => {
  runCleanups();
  document.body.innerHTML = "";
});

describe("Backlinks core plugin", () => {
  it("ships every string in all five locales", async () => {
    const { ctx } = await activate();
    expect(
      ctx.registerTranslations.mock.calls.map(([locale, namespace]) => [locale, namespace]),
    ).toEqual([
      ["en", "glyph.core.backlinks"],
      ["de", "glyph.core.backlinks"],
      ["es", "glyph.core.backlinks"],
      ["fa", "glyph.core.backlinks"],
      ["zh", "glyph.core.backlinks"],
    ]);
    const keySets = ctx.registerTranslations.mock.calls.map(([, , resources]) =>
      Object.keys(resources).sort(),
    );
    for (const keys of keySets) expect(keys).toEqual(keySets[0]);
  });

  it("adds one block to the Files panel, titled in the app's language", async () => {
    const { ctx, panel } = await activate();
    expect(ctx.ui.addSidebarPanel).toHaveBeenCalledTimes(1);
    expect(panel).toEqual({
      id: "backlinks",
      title: "glyph.core.backlinks:heading",
      location: "files",
      frame: { min: 80 },
      mount: expect.any(Function),
      mountHeading: expect.any(Function),
    });
  });

  it("keeps the row count in the heading current until cleaned up", async () => {
    const { ctx, fire, panel } = await activate();
    const el = mountPoint();
    panel.mountHeading?.(el, registerCleanup);
    expect(el.textContent).toBe("2");

    ctx.vault.backlinks.mockResolvedValue([rows[0]]);
    fire.vaultChange();
    await flushMicrotasks();
    expect(el.textContent).toBe("1");

    runCleanups();
    ctx.vault.backlinks.mockResolvedValue([]);
    fire.vaultChange();
    await flushMicrotasks();
    expect(el.textContent).toBe("1");
  });

  it("renders the links in the block and opens a clicked one at its line", async () => {
    const { ctx, panel } = await activate();
    const el = mountPoint();
    act(() => panel.mount(el, registerCleanup));

    expect(within(el).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(within(el).getByRole("button", { name: /Notes\/Travel\.md/ }));
    expect(ctx.navigation.openFile).toHaveBeenCalledWith("/workspace/Notes/Travel.md", {
      line: 12,
    });
  });

  it("redraws the block when the index changes", async () => {
    const { ctx, fire, panel } = await activate([]);
    const el = mountPoint();
    act(() => panel.mount(el, registerCleanup));
    expect(within(el).getByText("glyph.core.backlinks:empty")).toBeInTheDocument();

    ctx.vault.backlinks.mockResolvedValue(rows);
    await act(async () => {
      fire.vaultChange();
      await flushMicrotasks();
    });
    expect(within(el).getByText("Index.md")).toBeInTheDocument();
  });

  it("removes what it rendered once cleaned up", async () => {
    const { panel } = await activate();
    const el = mountPoint();
    act(() => panel.mount(el, registerCleanup));
    expect(within(el).getAllByRole("button")).toHaveLength(2);

    runCleanups();
    expect(el.textContent).toBe("");
  });

  it("adds the block again on a language switch, with the new strings", async () => {
    const { ctx, fire, panelDisposers } = await activate();
    ctx.i18n.t.mockImplementation((key) => `fa ${key}`);
    fire.languageChange();

    expect(panelDisposers[0]).toHaveBeenCalledOnce();
    expect(ctx.ui.addSidebarPanel).toHaveBeenCalledTimes(2);
    expect(ctx.ui.addSidebarPanel.mock.calls[1][0].title).toBe("fa glyph.core.backlinks:heading");
    expect(panelDisposers[1]).not.toHaveBeenCalled();

    // The next switch removes the block the previous switch added, not the first one again.
    fire.languageChange();
    expect(panelDisposers[0]).toHaveBeenCalledOnce();
    expect(panelDisposers[1]).toHaveBeenCalledOnce();
    expect(ctx.ui.addSidebarPanel).toHaveBeenCalledTimes(3);
  });
});
