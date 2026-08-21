// Back/forward navigation history: a linear stack of places the reader has been
// plus a cursor into it. Pure data; `useNavigationHistory` owns the side
// effects (recording tab changes and heading jumps, performing the moves).

export interface NavigationLocation {
  kind: "file" | "graph";
  /** `tabPathOf` the tab: the file path, or the workspace root for the graph. */
  path: string;
  heading?: string;
}

export interface NavigationEntry extends NavigationLocation {
  /** Scroll position the entry was left at, restored on a same-tab return. */
  scrollTop: number;
}

export interface NavigationHistory {
  entries: NavigationEntry[];
  /** Cursor into `entries`; -1 while empty. */
  index: number;
}

export const MAX_HISTORY = 100;

export function emptyHistory(): NavigationHistory {
  return { entries: [], index: -1 };
}

export function sameTab(a: NavigationLocation, b: NavigationLocation): boolean {
  return a.kind === b.kind && a.path === b.path;
}

function sameLocation(a: NavigationLocation, b: NavigationLocation): boolean {
  return sameTab(a, b) && a.heading === b.heading;
}

function stampCurrent(history: NavigationHistory, scrollTop: number): NavigationEntry[] {
  return history.entries.map((entry, i) => (i === history.index ? { ...entry, scrollTop } : entry));
}

/** Record `location` as the new current entry: a no-op when it already is the
 *  current entry, otherwise it drops any forward entries, remembers where the
 *  current entry was left (`leftAt`, when known), and trims the oldest past
 *  the cap. */
export function pushLocation(
  history: NavigationHistory,
  location: NavigationLocation,
  leftAt?: number,
): NavigationHistory {
  const current = history.entries[history.index];
  if (current && sameLocation(current, location)) return history;
  const entries = leftAt === undefined ? history.entries : stampCurrent(history, leftAt);
  const kept = entries.slice(0, history.index + 1);
  kept.push({ ...location, scrollTop: 0 });
  const trimmed = kept.length > MAX_HISTORY ? kept.slice(kept.length - MAX_HISTORY) : kept;
  return { entries: trimmed, index: trimmed.length - 1 };
}

export function stepBack(history: NavigationHistory, leftAt: number): NavigationHistory | null {
  if (history.index <= 0) return null;
  return { entries: stampCurrent(history, leftAt), index: history.index - 1 };
}

export function stepForward(history: NavigationHistory, leftAt: number): NavigationHistory | null {
  if (history.index >= history.entries.length - 1) return null;
  return { entries: stampCurrent(history, leftAt), index: history.index + 1 };
}
