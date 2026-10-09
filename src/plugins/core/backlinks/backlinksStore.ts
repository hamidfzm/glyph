import type { Backlink, Disposer, GlyphPluginContext } from "@/lib/plugins/types";

export interface BacklinksState {
  /** Workspace root the rows are shown relative to. */
  root: string | null;
  rows: readonly Backlink[];
}

export interface BacklinksStore {
  get(): BacklinksState;
  subscribe(listener: () => void): Disposer;
}

const NONE: readonly Backlink[] = [];

/**
 * Inbound links to the active note, kept current as the note, the index, or
 * the workspace changes. One store feeds the block's body and its count.
 */
export function createBacklinksStore(
  ctx: Pick<GlyphPluginContext, "documents" | "vault" | "workspace">,
): BacklinksStore {
  let state: BacklinksState = { root: null, rows: NONE };
  let shownPath: string | undefined;
  let latest = 0;
  const listeners = new Set<() => void>();

  const show = (path: string | undefined, next: BacklinksState) => {
    shownPath = path;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const refresh = () => {
    const request = ++latest;
    const root = ctx.workspace.getRoot();
    const path = ctx.documents.getActive()?.path;
    if (!root || !path) {
      show(undefined, { root, rows: NONE });
      return;
    }
    // Another note: blank for one round trip rather than the last note's links
    // under the new one. The same note keeps its rows until the fresh ones land.
    if (path !== shownPath || root !== state.root) show(path, { root, rows: NONE });
    ctx.vault.backlinks(path).then(
      (rows) => {
        if (request === latest) show(path, { root, rows });
      },
      (err) => {
        console.error(`Failed to read backlinks for ${path}:`, err);
        if (request === latest) show(path, { root, rows: NONE });
      },
    );
  };

  ctx.documents.onActiveChange(refresh);
  ctx.vault.onChange(refresh);
  ctx.workspace.onChange(refresh);
  refresh();

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
