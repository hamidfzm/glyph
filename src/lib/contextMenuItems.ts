// Builds the items for the in-app (themed) right-click menu. Kept separate from
// the hook and the component so the menu's contents are pure, easy to unit test,
// and free of any React or OS-native menu API.

import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { AI_ACTIONS } from "./aiPrompts";

export interface ContextMenuActions {
  ttsSpeak?: (text: string) => void;
  ttsStop?: () => void;
  ttsSpeaking?: boolean;
  ttsAvailable?: boolean;
  /** Run an AI quick action; `selection` present when text was selected,
   *  otherwise the action targets the whole document. */
  aiAction?: (action: string, selection?: string) => void;
  aiConfigured?: boolean;
  content?: string | null;
}

export interface ContextMenuActionItem {
  kind: "action";
  label: string;
  onSelect: () => void;
  /** Optional leading icon (used by the file-tree menu). */
  icon?: ReactNode;
  /** Render with destructive emphasis, e.g. a red "Delete". */
  danger?: boolean;
}

export interface ContextMenuSubmenuItem {
  kind: "submenu";
  label: string;
  items: ContextMenuActionItem[];
}

export type ContextMenuItem =
  | ContextMenuActionItem
  | { kind: "separator" }
  | ContextMenuSubmenuItem;

const SELECTION_PREVIEW_MAX = 30;

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
  t: TFunction<"common">,
): ContextMenuItem[] {
  const text: ContextMenuItem[] = [];
  if (selection) {
    text.push({
      kind: "action",
      label: t("contextMenu.copy"),
      onSelect: () => copySelection(selection),
    });
  }
  text.push({ kind: "action", label: t("contextMenu.selectAll"), onSelect: selectAllContent });
  if (selection) {
    text.push({
      kind: "action",
      label: t("contextMenu.searchGoogle", { query: selectionPreview(selection) }),
      onSelect: () => searchGoogle(selection),
    });
  }

  const tts: ContextMenuItem[] = [];
  if (actions.ttsAvailable) {
    if (actions.ttsSpeaking) {
      tts.push({
        kind: "action",
        label: t("contextMenu.stopReading"),
        onSelect: () => actions.ttsStop?.(),
      });
    } else {
      const textToRead = selection || actions.content || "";
      if (textToRead) {
        tts.push({
          kind: "action",
          label: selection ? t("contextMenu.readSelection") : t("contextMenu.readAloud"),
          onSelect: () => actions.ttsSpeak?.(textToRead),
        });
      }
    }
  }

  const ai: ContextMenuItem[] = [];
  if (actions.aiConfigured && (selection || actions.content)) {
    ai.push({
      kind: "submenu",
      label: t("contextMenu.ai"),
      items: AI_ACTIONS.map((action) => ({
        kind: "action" as const,
        label: t(selection ? "contextMenu.aiOnSelection" : "contextMenu.aiOnDocument", {
          action: t(`contextMenu.aiVerb.${action}`),
        }),
        // The document itself rides along in the chat's system prompt, so only
        // an explicit selection is passed as the action's target text.
        onSelect: () => actions.aiAction?.(action, selection || undefined),
      })),
    });
  }

  return joinGroups([text, tts, ai]);
}
