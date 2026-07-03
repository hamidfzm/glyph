import { listen } from "@tauri-apps/api/event";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MenuEventHandlers, useMenuEvents } from "./useMenuEvents";

function noopHandlers(overrides: Partial<MenuEventHandlers> = {}): MenuEventHandlers {
  return {
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openGraph: vi.fn(),
    closeTab: vi.fn(),
    toggleFilesSidebar: vi.fn(),
    toggleOutlineSidebar: vi.fn(),
    resetView: vi.fn(),
    openSettings: vi.fn(),
    openSyncSettings: vi.fn(),
    find: vi.fn(),
    toggleEdit: vi.fn(),
    print: vi.fn(),
    exportHtml: vi.fn(),
    exportDocx: vi.fn(),
    exportEpub: vi.fn(),
    exportPdf: vi.fn(),
    exportWebsite: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    aiAction: vi.fn(),
    aiChat: vi.fn(),
    readAloud: vi.fn(),
    documentation: vi.fn(),
    releaseNotes: vi.fn(),
    reportIssue: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listen).mockReset();
});

describe("useMenuEvents", () => {
  it("subscribes to every menu-* channel", () => {
    vi.mocked(listen).mockResolvedValue(() => {});
    renderHook(() => useMenuEvents(noopHandlers()));
    const channels = vi.mocked(listen).mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        "menu-open-file",
        "menu-open-folder",
        "menu-open-graph",
        "menu-close-tab",
        "menu-toggle-files-sidebar",
        "menu-toggle-outline-sidebar",
        "menu-reset-view",
        "menu-open-settings",
        "menu-open-sync-settings",
        "menu-find",
        "menu-toggle-edit",
        "menu-print",
        "menu-export-html",
        "menu-export-docx",
        "menu-export-epub",
        "menu-export-pdf",
        "menu-export-website",
        "menu-zoom-in",
        "menu-zoom-out",
        "menu-zoom-reset",
        "menu-ai-action",
        "menu-ai-chat",
        "menu-ai-read-aloud",
        "menu-documentation",
        "menu-release-notes",
        "menu-report-issue",
      ]),
    );
  });

  it("invokes the handler the listener was bound with", () => {
    const captured: Record<string, (event: { payload: unknown }) => void> = {};
    vi.mocked(listen).mockImplementation(((name: string, cb: (e: { payload: unknown }) => void) => {
      captured[name] = cb;
      return Promise.resolve(() => {});
    }) as unknown as typeof listen);

    const handlers = noopHandlers();
    renderHook(() => useMenuEvents(handlers));

    captured["menu-open-file"]?.({ payload: undefined });
    expect(handlers.openFile).toHaveBeenCalled();

    captured["menu-ai-action"]?.({ payload: "summarize" });
    expect(handlers.aiAction).toHaveBeenCalledWith("summarize");
  });

  it("unsubscribes on unmount", async () => {
    const unsubscribe = vi.fn();
    vi.mocked(listen).mockResolvedValue(unsubscribe);
    const { unmount } = renderHook(() => useMenuEvents(noopHandlers()));
    unmount();
    // unsubscribes are awaited inside the cleanup; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
