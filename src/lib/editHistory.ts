// Per-tab undo/redo stack for programmatic edits that originate outside the
// editor (task-list toggles, future rename refactors). The CodeMirror editor
// keeps its own history for typed input; this stack only covers writes that
// bypass it.

export interface EditEntry {
  before: string;
  after: string;
}

export interface TabHistory {
  undo: EditEntry[];
  redo: EditEntry[];
}

export const MAX_HISTORY_ENTRIES = 50;

export function emptyHistory(): TabHistory {
  return { undo: [], redo: [] };
}

export function pushEntry(history: TabHistory, entry: EditEntry): TabHistory {
  const undo = [...history.undo, entry];
  if (undo.length > MAX_HISTORY_ENTRIES) undo.shift();
  return { undo, redo: [] };
}

export function popUndo(history: TabHistory): { entry: EditEntry; next: TabHistory } | null {
  if (history.undo.length === 0) return null;
  const undo = history.undo.slice(0, -1);
  const entry = history.undo[history.undo.length - 1];
  return { entry, next: { undo, redo: [...history.redo, entry] } };
}

export function popRedo(history: TabHistory): { entry: EditEntry; next: TabHistory } | null {
  if (history.redo.length === 0) return null;
  const redo = history.redo.slice(0, -1);
  const entry = history.redo[history.redo.length - 1];
  return { entry, next: { undo: [...history.undo, entry], redo } };
}
