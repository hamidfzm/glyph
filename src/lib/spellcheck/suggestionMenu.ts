const MAX_SUGGESTIONS = 7;

/**
 * Merge suggestions across the dictionaries covering a word, first-seen order,
 * deduplicated, capped at {@link MAX_SUGGESTIONS}.
 */
export function mergedSuggestions(
  spellers: readonly { suggest(word: string): string[] }[],
  word: string,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const speller of spellers) {
    for (const suggestion of speller.suggest(word)) {
      if (seen.has(suggestion)) continue;
      seen.add(suggestion);
      merged.push(suggestion);
      if (merged.length === MAX_SUGGESTIONS) return merged;
    }
  }
  return merged;
}

export interface SuggestionMenuLabels {
  ignore: string;
  add: string;
  empty: string;
}

export interface SuggestionMenuOptions {
  x: number;
  y: number;
  suggestions: string[];
  labels: SuggestionMenuLabels;
  onPick: (replacement: string) => void;
  onIgnore: () => void;
  onAdd: () => void;
}

// Show a lightweight context menu of spelling corrections at (x, y). Imperative
// Closes whatever menu is currently open. Only one lives at a time, so a fresh
// right-click never leaks the previous menu's DOM node or document listeners.
let closeOpenMenu: (() => void) | null = null;

// DOM (not React) so it can be opened straight from a CodeMirror contextmenu
// handler. Closes on the next outside click, Escape, or after any action.
export function openSuggestionMenu(options: SuggestionMenuOptions): void {
  closeOpenMenu?.();

  const menu = document.createElement("div");
  menu.className = "spellcheck-menu";
  menu.style.left = `${options.x}px`;
  menu.style.top = `${options.y}px`;

  function close(): void {
    menu.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    // A newer menu always closes this one before taking over closeOpenMenu, so
    // this close only ever runs while this menu owns the reference.
    closeOpenMenu = null;
  }

  function onOutside(event: MouseEvent): void {
    if (!menu.contains(event.target as Node)) close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }

  function addItem(label: string, className: string, action: () => void): void {
    const item = document.createElement("button");
    item.type = "button";
    item.className = className;
    item.textContent = label;
    item.addEventListener("click", () => {
      action();
      close();
    });
    menu.appendChild(item);
  }

  if (options.suggestions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "spellcheck-menu-empty";
    empty.textContent = options.labels.empty;
    menu.appendChild(empty);
  } else {
    for (const suggestion of options.suggestions) {
      addItem(suggestion, "spellcheck-menu-item", () => options.onPick(suggestion));
    }
  }

  const divider = document.createElement("div");
  divider.className = "spellcheck-menu-divider";
  menu.appendChild(divider);

  addItem(options.labels.ignore, "spellcheck-menu-item spellcheck-menu-action", options.onIgnore);
  addItem(options.labels.add, "spellcheck-menu-item spellcheck-menu-action", options.onAdd);

  document.body.appendChild(menu);
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  closeOpenMenu = close;
}
