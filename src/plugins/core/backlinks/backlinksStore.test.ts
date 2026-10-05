import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveDocument, Backlink } from "@/lib/plugins/types";
import { createBacklinksStore } from "./backlinksStore";

const ROOT = "/workspace";
const NOTE = "/workspace/Cooking.md";
const OTHER_NOTE = "/workspace/Baking.md";
const rows: Backlink[] = [{ source: "/workspace/Index.md", line: 4, snippet: "see [[Cooking]]" }];
const otherRows: Backlink[] = [
  { source: "/workspace/Notes/Travel.md", line: 12, snippet: "ref to [[Baking]] here" },
];

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

const documentAt = (path: string): ActiveDocument => ({ path, text: null, selection: "" });

/** A fake app with a note open in a workspace; `fire` plays the app's change events. */
function setup() {
  const fire = { activeChange: () => {}, vaultChange: () => {}, workspaceChange: () => {} };
  const ctx = {
    documents: {
      getActive: vi.fn<() => ActiveDocument | null>(() => documentAt(NOTE)),
      onActiveChange: vi.fn((listener: () => void) => {
        fire.activeChange = listener;
        return vi.fn();
      }),
    },
    vault: {
      backlinks: vi.fn<(path: string) => Promise<Backlink[]>>(async () => rows),
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
  };
  const start = () =>
    createBacklinksStore(ctx as unknown as Parameters<typeof createBacklinksStore>[0]);
  return { ctx, fire, start };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBacklinksStore", () => {
  it("asks the vault for the links into the active note", async () => {
    const { ctx, start } = setup();
    const store = start();

    expect(ctx.vault.backlinks).toHaveBeenCalledWith(NOTE);
    expect(store.get()).toEqual({ root: ROOT, rows: [] });
    await flushMicrotasks();
    expect(store.get()).toEqual({ root: ROOT, rows });
  });

  it("stays empty without a workspace, asking the vault nothing", async () => {
    const { ctx, start } = setup();
    ctx.workspace.getRoot.mockReturnValue(null);
    const store = start();
    await flushMicrotasks();

    expect(store.get()).toEqual({ root: null, rows: [] });
    expect(ctx.vault.backlinks).not.toHaveBeenCalled();
  });

  it("stays empty without an active document, asking the vault nothing", async () => {
    const { ctx, start } = setup();
    ctx.documents.getActive.mockReturnValue(null);
    const store = start();
    await flushMicrotasks();

    expect(store.get()).toEqual({ root: ROOT, rows: [] });
    expect(ctx.vault.backlinks).not.toHaveBeenCalled();
  });

  it("empties the rows when another note becomes active, until its own arrive", async () => {
    const { ctx, fire, start } = setup();
    const store = start();
    await flushMicrotasks();

    const pending = deferred<Backlink[]>();
    ctx.documents.getActive.mockReturnValue(documentAt(OTHER_NOTE));
    ctx.vault.backlinks.mockReturnValue(pending.promise);
    fire.activeChange();
    expect(ctx.vault.backlinks).toHaveBeenLastCalledWith(OTHER_NOTE);
    expect(store.get().rows).toEqual([]);

    pending.resolve(otherRows);
    await flushMicrotasks();
    expect(store.get().rows).toEqual(otherRows);
  });

  it("keeps the note's rows while a re-query after an index change is in flight", async () => {
    const { ctx, fire, start } = setup();
    const store = start();
    await flushMicrotasks();

    const pending = deferred<Backlink[]>();
    ctx.vault.backlinks.mockReturnValue(pending.promise);
    fire.vaultChange();
    expect(ctx.vault.backlinks).toHaveBeenCalledTimes(2);
    expect(store.get().rows).toEqual(rows);

    pending.resolve(otherRows);
    await flushMicrotasks();
    expect(store.get().rows).toEqual(otherRows);
  });

  it("empties the rows when the same note shows up under another workspace root", async () => {
    const { ctx, fire, start } = setup();
    const store = start();
    await flushMicrotasks();

    ctx.workspace.getRoot.mockReturnValue("/workspace/Notes");
    ctx.vault.backlinks.mockReturnValue(deferred<Backlink[]>().promise);
    fire.workspaceChange();
    expect(store.get()).toEqual({ root: "/workspace/Notes", rows: [] });
  });

  it("drops an answer that arrives after the document was closed", async () => {
    const { ctx, fire, start } = setup();
    const pending = deferred<Backlink[]>();
    ctx.vault.backlinks.mockReturnValue(pending.promise);
    const store = start();

    ctx.documents.getActive.mockReturnValue(null);
    fire.activeChange();
    pending.resolve(rows);
    await flushMicrotasks();
    expect(store.get().rows).toEqual([]);
  });

  it("logs a failed query and falls back to no rows", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, fire, start } = setup();
    const store = start();
    await flushMicrotasks();
    expect(store.get().rows).toEqual(rows);

    const failure = new Error("index unavailable");
    ctx.vault.backlinks.mockRejectedValue(failure);
    fire.vaultChange();
    await flushMicrotasks();

    expect(error).toHaveBeenCalledWith(expect.stringContaining(NOTE), failure);
    expect(store.get()).toEqual({ root: ROOT, rows: [] });
  });

  it("never lets a stale answer replace the newest one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, fire, start } = setup();
    const first = deferred<Backlink[]>();
    const second = deferred<Backlink[]>();
    const third = deferred<Backlink[]>();
    ctx.vault.backlinks
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const store = start();
    fire.vaultChange();
    fire.vaultChange();

    third.resolve(rows);
    await flushMicrotasks();
    expect(store.get().rows).toEqual(rows);

    first.resolve(otherRows);
    await flushMicrotasks();
    expect(store.get().rows).toEqual(rows);

    second.reject(new Error("index unavailable"));
    await flushMicrotasks();
    expect(store.get().rows).toEqual(rows);
  });

  it("notifies subscribers until they unsubscribe", async () => {
    const { fire, start } = setup();
    const store = start();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await flushMicrotasks();
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    fire.activeChange();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();
  });
});
