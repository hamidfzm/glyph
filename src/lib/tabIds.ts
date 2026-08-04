// Session-monotonic counters for the tab strip. Module-level so ids and
// Untitled titles are never reused within a window, even after a close or save.

let nextId = 0;

export function generateTabId(): string {
  nextId++;
  return `tab-${nextId}`;
}

let nextUntitled = 0;

export function nextUntitledTitle(): string {
  nextUntitled++;
  return `Untitled-${nextUntitled}`;
}
