import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileTreeFilter, TagCount } from "@/lib/plugins/types";
import { createTagsStore } from "./tagsStore";

const ROOT = "/workspace";
const tags: TagCount[] = [
  { tag: "work", count: 2 },
  { tag: "ideas", count: 1 },
];
const tagged: Record<string, string[]> = {
  work: ["/workspace/Plan.md", "/workspace/Notes/Todo.md"],
  ideas: ["/workspace/Ideas.md"],
};
const filterLabel = (tag: string, total: number) => `#${tag} (${total})`;

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fake app with a tagged workspace open; `fire` plays the app's change events. */
function setup() {
  const fire = { vaultChange: () => {}, workspaceChange: () => {} };
  const removeFilters: Array<ReturnType<typeof vi.fn>> = [];
  const ctx = {
    vault: {
      tags: vi.fn<() => Promise<TagCount[]>>(async () => tags),
      pathsWithTag: vi.fn<(tag: string) => Promise<string[]>>(async (tag) => tagged[tag]),
      onChange: vi.fn((listener: () => void) => {
        fire.vaultChange = listener;
        return vi.fn();
      }),
    },
    workspace: {
      getRoot: vi.fn<() => string | null>(() => ROOT),
      onChange: vi.fn((listener: () => void) => {
        fire.workspaceChange = listener;
        return vi.fn();
      }),
    },
    ui: {
      filterFileTree: vi.fn((_filter: FileTreeFilter) => {
        const remove = vi.fn();
        removeFilters.push(remove);
        return remove;
      }),
    },
  };
  const start = (label = filterLabel) =>
    createTagsStore(ctx as unknown as Parameters<typeof createTagsStore>[0], label);
  return { ctx, fire, removeFilters, start };
}

/** A store whose tags have arrived, with `selected` (if any) filtering the file list. */
async function loaded(selected?: string) {
  const fake = setup();
  const store = fake.start();
  await flushMicrotasks();
  if (selected) {
    store.select(selected);
    await flushMicrotasks();
  }
  return { ...fake, store };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createTagsStore", () => {
  it("loads the workspace's tags, sorted by name with nothing selected", async () => {
    const { ctx, start } = setup();
    const store = start();
    expect(store.get()).toEqual({ tags: [], sort: "name", selected: null });

    await flushMicrotasks();
    expect(store.get()).toEqual({ tags, sort: "name", selected: null });
    expect(ctx.ui.filterFileTree).not.toHaveBeenCalled();
  });

  it("has no tags without a workspace, asking the vault nothing", async () => {
    const { ctx, start } = setup();
    ctx.workspace.getRoot.mockReturnValue(null);
    const store = start();
    await flushMicrotasks();

    expect(store.get().tags).toEqual([]);
    expect(ctx.vault.tags).not.toHaveBeenCalled();
  });

  it("flips the sort between name and count", async () => {
    const { store } = await loaded();
    store.toggleSort();
    expect(store.get().sort).toBe("count");
    store.toggleSort();
    expect(store.get().sort).toBe("name");
  });

  it("lists the files of the selected tag in place of the file tree", async () => {
    const { ctx, store } = await loaded();
    store.select("work");
    expect(store.get().selected).toBe("work");
    expect(ctx.vault.pathsWithTag).toHaveBeenCalledWith("work");

    await flushMicrotasks();
    expect(ctx.ui.filterFileTree).toHaveBeenCalledTimes(1);
    expect(ctx.ui.filterFileTree).toHaveBeenCalledWith({
      label: "#work (2)",
      paths: tagged.work,
      onClear: expect.any(Function),
    });
  });

  it("clears the selection and the filter when the user dismisses the list", async () => {
    const { ctx, removeFilters, store } = await loaded("work");
    ctx.ui.filterFileTree.mock.calls[0][0].onClear();

    expect(store.get().selected).toBeNull();
    expect(removeFilters[0]).toHaveBeenCalledOnce();
  });

  it("removes the filter when the selection is cleared", async () => {
    const { ctx, removeFilters, store } = await loaded("work");
    store.select(null);

    expect(store.get().selected).toBeNull();
    expect(removeFilters[0]).toHaveBeenCalledOnce();
    expect(ctx.ui.filterFileTree).toHaveBeenCalledTimes(1);
  });

  it("keeps the list on screen until the next tag's files arrive, then swaps", async () => {
    const { ctx, removeFilters, store } = await loaded("work");
    const pending = deferred<string[]>();
    ctx.vault.pathsWithTag.mockReturnValueOnce(pending.promise);
    store.select("ideas");
    expect(store.get().selected).toBe("ideas");
    expect(removeFilters[0]).not.toHaveBeenCalled();

    pending.resolve(tagged.ideas);
    await flushMicrotasks();
    expect(ctx.ui.filterFileTree).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "#ideas (1)", paths: tagged.ideas }),
    );
    expect(removeFilters[0]).toHaveBeenCalledOnce();
    expect(removeFilters[0].mock.invocationCallOrder[0]).toBeLessThan(
      ctx.ui.filterFileTree.mock.invocationCallOrder[1],
    );
    expect(removeFilters[1]).not.toHaveBeenCalled();
  });

  it("never lists a slow answer for a tag the user moved on from", async () => {
    const { ctx, removeFilters, store } = await loaded();
    const slow = deferred<string[]>();
    ctx.vault.pathsWithTag.mockReturnValueOnce(slow.promise);
    store.select("work");
    store.select("ideas");
    await flushMicrotasks();
    expect(ctx.ui.filterFileTree).toHaveBeenCalledTimes(1);

    slow.resolve(tagged.work);
    await flushMicrotasks();
    expect(ctx.ui.filterFileTree).toHaveBeenCalledTimes(1);
    expect(ctx.ui.filterFileTree).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "#ideas (1)" }),
    );
    expect(removeFilters[0]).not.toHaveBeenCalled();
  });

  it("never lists the files of a selection cleared before they arrived", async () => {
    const { ctx, store } = await loaded();
    const slow = deferred<string[]>();
    ctx.vault.pathsWithTag.mockReturnValueOnce(slow.promise);
    store.select("work");
    store.select(null);

    slow.resolve(tagged.work);
    await flushMicrotasks();
    expect(ctx.ui.filterFileTree).not.toHaveBeenCalled();
  });

  it("logs a failed file listing and clears the selection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, store } = await loaded();
    const failure = new Error("index unavailable");
    ctx.vault.pathsWithTag.mockRejectedValueOnce(failure);
    store.select("work");
    await flushMicrotasks();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("work"), failure);
    expect(store.get().selected).toBeNull();
    expect(ctx.ui.filterFileTree).not.toHaveBeenCalled();
  });

  it("keeps the current selection when an abandoned tag's listing fails late", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, removeFilters, store } = await loaded();
    const slow = deferred<string[]>();
    ctx.vault.pathsWithTag.mockReturnValueOnce(slow.promise);
    store.select("work");
    store.select("ideas");
    await flushMicrotasks();

    slow.reject(new Error("index unavailable"));
    await flushMicrotasks();
    expect(store.get().selected).toBe("ideas");
    expect(removeFilters[0]).not.toHaveBeenCalled();
  });

  it("lists the selected tag's files afresh after the index changes", async () => {
    const { ctx, fire, removeFilters, store } = await loaded("work");
    ctx.vault.pathsWithTag.mockResolvedValueOnce(["/workspace/Plan.md"]);
    fire.vaultChange();
    await flushMicrotasks();

    expect(store.get().selected).toBe("work");
    expect(removeFilters[0]).toHaveBeenCalledOnce();
    expect(ctx.ui.filterFileTree).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "#work (1)", paths: ["/workspace/Plan.md"] }),
    );
  });

  it("clears a selected tag the index no longer has", async () => {
    const { ctx, fire, removeFilters, store } = await loaded("work");
    ctx.vault.tags.mockResolvedValueOnce([tags[1]]);
    fire.vaultChange();
    await flushMicrotasks();

    expect(store.get()).toEqual({ tags: [tags[1]], sort: "name", selected: null });
    expect(removeFilters[0]).toHaveBeenCalledOnce();
    expect(ctx.ui.filterFileTree).toHaveBeenCalledTimes(1);
  });

  it("clears the selection when another workspace opens", async () => {
    const { ctx, fire, removeFilters, store } = await loaded("work");
    const otherTags: TagCount[] = [{ tag: "work", count: 7 }];
    ctx.workspace.getRoot.mockReturnValue("/elsewhere");
    ctx.vault.tags.mockResolvedValue(otherTags);
    fire.workspaceChange();
    expect(store.get().selected).toBeNull();
    expect(removeFilters[0]).toHaveBeenCalledOnce();

    await flushMicrotasks();
    expect(store.get().tags).toEqual(otherTags);
    expect(ctx.ui.filterFileTree).toHaveBeenCalledTimes(1);
  });

  // Another vault's tags must not sit under this one, least of all when its
  // own read then fails and there is nothing to replace them with.
  it("drops the previous workspace's tags before the new ones arrive", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, fire, store } = await loaded();
    ctx.workspace.getRoot.mockReturnValue("/other");
    ctx.vault.tags.mockRejectedValue(new Error("denied"));

    fire.workspaceChange();
    expect(store.get().tags).toEqual([]);
    await flushMicrotasks();
    expect(store.get().tags).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("drops the tags and the filter when the workspace closes", async () => {
    const { ctx, fire, removeFilters, store } = await loaded("work");
    ctx.workspace.getRoot.mockReturnValue(null);
    fire.workspaceChange();

    expect(store.get()).toEqual({ tags: [], sort: "name", selected: null });
    expect(removeFilters[0]).toHaveBeenCalledOnce();
    expect(ctx.vault.tags).toHaveBeenCalledTimes(1);
  });

  it("logs a failed tags read and keeps the tags it had", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, fire, store } = await loaded();
    const failure = new Error("index unavailable");
    ctx.vault.tags.mockRejectedValueOnce(failure);
    fire.vaultChange();
    await flushMicrotasks();

    expect(error).toHaveBeenCalledWith(expect.any(String), failure);
    expect(store.get().tags).toEqual(tags);
  });

  it("ignores a tags answer that lands after a newer one", async () => {
    const { ctx, fire, start } = setup();
    const slow = deferred<TagCount[]>();
    ctx.vault.tags.mockReturnValueOnce(slow.promise);
    const store = start();
    fire.vaultChange();
    await flushMicrotasks();
    expect(store.get().tags).toEqual(tags);

    slow.resolve([{ tag: "stale", count: 1 }]);
    await flushMicrotasks();
    expect(store.get().tags).toEqual(tags);
  });

  it("relabels the filter on refresh, as after a language switch", async () => {
    let language = "en";
    const { ctx, removeFilters, start } = setup();
    const store = start((tag, total) => `${language} #${tag} (${total})`);
    await flushMicrotasks();
    store.select("work");
    await flushMicrotasks();
    expect(ctx.ui.filterFileTree).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "en #work (2)" }),
    );

    language = "fa";
    store.refresh();
    await flushMicrotasks();
    expect(removeFilters[0]).toHaveBeenCalledOnce();
    expect(ctx.ui.filterFileTree).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "fa #work (2)" }),
    );
  });

  it("notifies subscribers until they unsubscribe", async () => {
    const { store } = await loaded();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.toggleSort();
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    store.toggleSort();
    expect(listener).toHaveBeenCalledOnce();
  });
});
