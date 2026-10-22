import type { SavableDocument } from "@/hooks/useAutoSave";
import type { FileTab, Tab } from "@/lib/tabs";

// Every dirty tab, not just the active one, so switching tabs never cancels a
// pending save. Untitled ones are left out: their Save As waits for Save or close.
export function autoSaveDocuments(tabs: Tab[]): SavableDocument[] {
  return tabs
    .filter((tab): tab is FileTab => tab.kind === "file" && tab.file.dirty && !tab.file.virtual)
    .map((tab) => ({ id: tab.id, revision: tab.file.revision }));
}
