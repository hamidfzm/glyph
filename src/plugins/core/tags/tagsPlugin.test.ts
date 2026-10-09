import { act, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Disposer,
  FileTreeFilter,
  GlyphPluginContext,
  SidebarPanelContribution,
  TagCount,
} from "@/lib/plugins/types";
import plugin from "./tagsPlugin";

const tags: TagCount[] = [
  { tag: "work", count: 3 },
  { tag: "ideas", count: 1 },
];
const tagged = ["/workspace/Plan.md", "/workspace/Notes/Todo.md"];

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// A translation reads as its key followed by its values: `ns:filterBy work`.
const translate = (key: string, values: Record<string, unknown> = {}) =>
  [key, ...Object.values(values)].join(" ");

function fakeContext() {
  const fire = { languageChange: () => {} };
  const panelDisposers: Array<ReturnType<typeof vi.fn>> = [];
  const filterDisposers: Array<ReturnType<typeof vi.fn>> = [];
  const ctx = {
    registerTranslations: vi.fn(),
    i18n: {
      t: vi.fn(translate),
      onLanguageChange: vi.fn((listener: () => void) => {
        fire.languageChange = listener;
        return vi.fn();
      }),
    },
    ui: {
      addStyles: vi.fn(() => vi.fn()),
      addSidebarPanel: vi.fn((_panel: SidebarPanelContribution) => {
        const dispose = vi.fn();
        panelDisposers.push(dispose);
        return dispose;
      }),
      filterFileTree: vi.fn((_filter: FileTreeFilter) => {
        const dispose = vi.fn();
        filterDisposers.push(dispose);
        return dispose;
      }),
    },
    vault: {
      tags: vi.fn(async () => tags),
      pathsWithTag: vi.fn(async () => tagged),
      onChange: vi.fn(() => vi.fn()),
    },
    workspace: { getRoot: vi.fn(() => "/workspace"), onChange: vi.fn(() => vi.fn()) },
  };
  return { ctx, fire, panelDisposers, filterDisposers };
}

/** Activate the plugin and wait for the tags; returns the panel it added. */
async function activate() {
  const fake = fakeContext();
  await plugin.activate(fake.ctx as unknown as GlyphPluginContext);
  await flushMicrotasks();
  return { ...fake, panel: fake.ctx.ui.addSidebarPanel.mock.calls[0][0] };
}

const cleanups: Disposer[] = [];
const registerCleanup = (cleanup: Disposer) => {
  cleanups.push(cleanup);
};

/** Mount the block the way the host does: the heading's extras and the body. */
function mountBlock(panel: SidebarPanelContribution) {
  const heading = document.createElement("div");
  const body = document.createElement("div");
  document.body.append(heading, body);
  act(() => {
    panel.mountHeading?.(heading, registerCleanup);
    panel.mount(body, registerCleanup);
  });
  return { heading, body };
}

function chipLabels(body: HTMLElement) {
  return within(body)
    .getAllByRole("button")
    .map((chip) => chip.textContent);
}

// Cleanup empties the plugin's React roots, an update that has to land inside act.
function runCleanups(): void {
  act(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
}

afterEach(() => {
  runCleanups();
  document.body.innerHTML = "";
});

describe("Tags core plugin", () => {
  it("ships every string in all five locales", async () => {
    const { ctx } = await activate();
    expect(
      ctx.registerTranslations.mock.calls.map(([locale, namespace]) => [locale, namespace]),
    ).toEqual([
      ["en", "glyph.core.tags"],
      ["de", "glyph.core.tags"],
      ["es", "glyph.core.tags"],
      ["fa", "glyph.core.tags"],
      ["zh", "glyph.core.tags"],
    ]);
    const keySets = ctx.registerTranslations.mock.calls.map(([, , resources]) =>
      Object.keys(resources).sort(),
    );
    for (const keys of keySets) expect(keys).toEqual(keySets[0]);
  });

  it("adds its stylesheet and one block to the Files panel", async () => {
    const { ctx, panel } = await activate();
    // Vitest does not process CSS, so the stylesheet text itself is checked by the build.
    expect(ctx.ui.addStyles).toHaveBeenCalledWith(expect.any(String));
    expect(ctx.ui.addSidebarPanel).toHaveBeenCalledTimes(1);
    expect(panel).toEqual({
      id: "tags",
      title: "glyph.core.tags:heading",
      location: "files",
      frame: { min: 56, naturalMax: 160 },
      mount: expect.any(Function),
      mountHeading: expect.any(Function),
    });
  });

  it("renders the tag count in the heading and one chip per tag in the block", async () => {
    const { panel } = await activate();
    const { heading, body } = mountBlock(panel);

    expect(within(heading).getByText("2")).toBeInTheDocument();
    expect(within(body).getAllByRole("button")).toHaveLength(2);
    expect(
      within(body).getByRole("button", { name: "glyph.core.tags:filterBy work" }),
    ).toHaveTextContent("#work3");
  });

  it("sorts the chips from the heading, through the store both share", async () => {
    const { panel } = await activate();
    const { heading, body } = mountBlock(panel);
    expect(chipLabels(body)).toEqual(["#ideas1", "#work3"]);

    fireEvent.click(within(heading).getByRole("button", { name: "glyph.core.tags:sortByCount" }));
    expect(chipLabels(body)).toEqual(["#work3", "#ideas1"]);
  });

  it("lists a clicked tag's files in place of the file tree, labelled in the app's language", async () => {
    const { ctx, panel } = await activate();
    const { body } = mountBlock(panel);
    fireEvent.click(within(body).getByRole("button", { name: "glyph.core.tags:filterBy work" }));
    await flushMicrotasks();

    expect(ctx.vault.pathsWithTag).toHaveBeenCalledWith("work");
    expect(ctx.ui.filterFileTree).toHaveBeenCalledWith({
      label: "glyph.core.tags:filtered work 2",
      paths: tagged,
      onClear: expect.any(Function),
    });
  });

  it("removes what it rendered once cleaned up", async () => {
    const { panel } = await activate();
    const { heading, body } = mountBlock(panel);
    expect(within(body).getAllByRole("button")).toHaveLength(2);

    runCleanups();
    expect(heading.textContent).toBe("");
    expect(body.textContent).toBe("");
  });

  it("adds the block again on a language switch and relabels the filter", async () => {
    const { ctx, fire, panel, panelDisposers, filterDisposers } = await activate();
    const { body } = mountBlock(panel);
    fireEvent.click(within(body).getByRole("button", { name: "glyph.core.tags:filterBy work" }));
    await flushMicrotasks();

    ctx.i18n.t.mockImplementation((key, values) => `fa ${translate(key, values)}`);
    await act(async () => {
      fire.languageChange();
      await flushMicrotasks();
    });

    expect(panelDisposers[0]).toHaveBeenCalledOnce();
    expect(ctx.ui.addSidebarPanel).toHaveBeenCalledTimes(2);
    expect(ctx.ui.addSidebarPanel.mock.calls[1][0].title).toBe("fa glyph.core.tags:heading");
    expect(panelDisposers[1]).not.toHaveBeenCalled();
    expect(filterDisposers[0]).toHaveBeenCalledOnce();
    expect(ctx.ui.filterFileTree).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "fa glyph.core.tags:filtered work 2" }),
    );
  });
});
