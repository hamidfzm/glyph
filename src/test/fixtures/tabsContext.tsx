import type { ReactNode } from "react";
import { vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { COMPLETE_INDEX_STATUS } from "@/lib/workspaceScan";

// The full TabsContext surface as inert defaults, so a test only spells out the
// fields it asserts on. Every component that reads the context needs the whole
// shape, which is why this lives here instead of being restated per file.

export function tabsContextValue(over: Partial<TabsContextValue> = {}): TabsContextValue {
  return {
    tabs: [],
    activeTab: null,
    activeTabId: null,
    activeFile: null,
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    metadataEntries: [],
    metadata: new Map(),
    indexStatus: COMPLETE_INDEX_STATUS,
    workspace: null,
    newDocument: vi.fn(),
    openFile: vi.fn(),
    openFolder: vi.fn(),
    createWorkspace: vi.fn(),
    openGraph: vi.fn(),
    closeWorkspace: vi.fn(),
    toggleExpand: vi.fn(),
    createNote: vi.fn(),
    createNoteInWorkspace: vi.fn(),
    createCanvasInWorkspace: vi.fn(),
    createCanvas: vi.fn(),
    commitEdit: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    duplicatePath: vi.fn(),
    movePath: vi.fn(),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
    deletePath: vi.fn(),
    closeTab: vi.fn(),
    closeTabs: vi.fn(),
    setActiveTab: vi.fn(),
    moveTab: vi.fn(),
    moveActiveTab: vi.fn(),
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
    setTabMode: vi.fn(),
    updateEditContent: vi.fn(),
    saveDocument: vi.fn(),
    flushForClose: vi.fn(),
    flushSessionForClose: vi.fn(async () => {}),
    toggleTask: vi.fn(),
    saveScrollPosition: vi.fn(),
    openFileDialog: vi.fn(),
    undoEdit: vi.fn(),
    redoEdit: vi.fn(),
    displayContent: null,
    tocEntries: [],
    backlinks: [],
    workspaceNotice: null,
    dismissWorkspaceNotice: vi.fn(),
    ...over,
  };
}

/** Provider wrapper for tests that render a component reading TabsContext. */
export function TabsWrapper({ value, children }: { value: TabsContextValue; children: ReactNode }) {
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}
