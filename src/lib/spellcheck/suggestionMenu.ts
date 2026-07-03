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
// DOM (not React) so it can be opened straight from a CodeMirror contextmenu
// handler. Closes on the next outside click, Escape, or after any action.
export function openSuggestionMenu(options: SuggestionMenuOptions): void {
  const menu = document.createElement("div");
  menu.className = "spellcheck-menu";
  menu.style.left = `${options.x}px`;
  menu.style.top = `${options.y}px`;

  function close(): void {
    menu.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  }

  function onOutside(event: MouseEvent): void {
    if (!menu.contains(event.target as Node)) close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }

  function addItem(label: string, action: () => void, extraClass = ""): void {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `spellcheck-menu-item${extraClass ? ` ${extraClass}` : ""}`;
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
      addItem(suggestion, () => options.onPick(suggestion));
    }
  }

  const divider = document.createElement("div");
  divider.className = "spellcheck-menu-divider";
  menu.appendChild(divider);

  addItem(options.labels.ignore, options.onIgnore, "spellcheck-menu-action");
  addItem(options.labels.add, options.onAdd, "spellcheck-menu-action");

  document.body.appendChild(menu);
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
}
