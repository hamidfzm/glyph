// Builds the items for the in-app (themed) right-click menu. Kept separate from
// the hook and the component so the menu's contents are pure, easy to unit test,
// and free of any React or OS-native menu API.

export interface ContextMenuActions {
  ttsSpeak?: (text: string) => void;
  ttsStop?: () => void;
  ttsSpeaking?: boolean;
  ttsAvailable?: boolean;
  aiAction?: (action: string, text: string) => void;
  aiConfigured?: boolean;
  content?: string | null;
}

export interface ContextMenuActionItem {
  kind: "action";
  label: string;
  onSelect: () => void;
}

export type ContextMenuItem =
  | ContextMenuActionItem
  | { kind: "separator" }
  | { kind: "submenu"; label: string; items: ContextMenuActionItem[] };

const SELECTION_PREVIEW_MAX = 30;
const AI_ACTIONS = ["Summarize", "Explain", "Translate", "Simplify"] as const;

/** Copy text to the clipboard. The text is captured up front (not read live)
 *  so it survives focus moving from the document selection to the menu. */
export function copySelection(text: string): void {
  // Best-effort: the clipboard write can reject when the window isn't focused
  // or permission is denied. There's no meaningful recovery for a copy gesture,
  // so the rejection is swallowed rather than surfaced to the user.
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

/** Select the rendered document body (falls back to the whole page). */
export function selectAllContent(): void {
  const target = document.querySelector(".markdown-body") ?? document.body;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function searchGoogle(query: string): void {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  window.open(url, "_blank");
}

function selectionPreview(selection: string): string {
  if (selection.length <= SELECTION_PREVIEW_MAX) return selection;
  return `${selection.slice(0, SELECTION_PREVIEW_MAX)}…`;
}

/** Join non-empty groups with a single separator between each. */
function joinGroups(groups: ContextMenuItem[][]): ContextMenuItem[] {
  const result: ContextMenuItem[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (result.length > 0) result.push({ kind: "separator" });
    result.push(...group);
  }
  return result;
}

export function buildContextMenuItems(
  actions: ContextMenuActions,
  selection: string,
): ContextMenuItem[] {
  const text: ContextMenuItem[] = [];
  if (selection) {
    text.push({ kind: "action", label: "Copy", onSelect: () => copySelection(selection) });
  }
  text.push({ kind: "action", label: "Select All", onSelect: selectAllContent });
  if (selection) {
    text.push({
      kind: "action",
      label: `Search Google for "${selectionPreview(selection)}"`,
      onSelect: () => searchGoogle(selection),
    });
  }

  const tts: ContextMenuItem[] = [];
  if (actions.ttsAvailable) {
    if (actions.ttsSpeaking) {
      tts.push({ kind: "action", label: "Stop Reading", onSelect: () => actions.ttsStop?.() });
    } else {
      const textToRead = selection || actions.content || "";
      if (textToRead) {
        tts.push({
          kind: "action",
          label: selection ? "Read Selection Aloud" : "Read Aloud",
          onSelect: () => actions.ttsSpeak?.(textToRead),
        });
      }
    }
  }

  const ai: ContextMenuItem[] = [];
  if (actions.aiConfigured) {
    const textForAI = selection || actions.content || "";
    if (textForAI) {
      ai.push({
        kind: "submenu",
        label: "AI",
        items: AI_ACTIONS.map((action) => ({
          kind: "action" as const,
          label: selection ? `${action} Selection` : `${action} Document`,
          onSelect: () => actions.aiAction?.(action.toLowerCase(), textForAI),
        })),
      });
    }
  }

  return joinGroups([text, tts, ai]);
}
