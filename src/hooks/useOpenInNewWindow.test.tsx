import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { useOpenInNewWindow } from "@/hooks/useOpenInNewWindow";
import type { Tab } from "@/lib/tabs";
import { tabsContextValue } from "@/test/fixtures/tabsContext";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/telemetry", () => ({ captureException: vi.fn() }));

const NOTE = "/ws/note.md";

function openTab(path: string): Tab {
  return {
    id: "tab-0",
    kind: "file",
    file: { path, content: "hi", mode: "view", dirty: false, metadata: null, virtual: false },
  } as Tab;
}

/** Render the hook over a tabs context whose `closeTabs` the test controls. */
function render(overrides: Partial<TabsContextValue> = {}) {
  const value = tabsContextValue(overrides);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TabsContext value={value}>{children}</TabsContext>
  );
  return { ...renderHook(() => useOpenInNewWindow(), { wrapper }), value };
}

describe("useOpenInNewWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("opens a note that is not open in this window", async () => {
    const closeTabs = vi.fn(async () => true);
    const { result } = render({ tabs: [], closeTabs });

    await act(() => result.current(NOTE));

    expect(closeTabs).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("open_in_new_window", { path: NOTE });
  });

  it("moves a note that is open here by closing its tab first", async () => {
    // Two windows over one path would each hold their own edit buffer.
    const order: string[] = [];
    const closeTabs = vi.fn(async () => {
      order.push("close");
      return true;
    });
    vi.mocked(invoke).mockImplementation(async () => {
      order.push("invoke");
    });
    const { result } = render({ tabs: [openTab(NOTE)], closeTabs });

    await act(() => result.current(NOTE));

    expect(closeTabs).toHaveBeenCalledWith(["tab-0"]);
    expect(order).toEqual(["close", "invoke"]);
  });

  it("aborts when the unsaved-changes prompt is cancelled", async () => {
    const closeTabs = vi.fn(async () => false);
    const { result } = render({ tabs: [openTab(NOTE)], closeTabs });

    await act(() => result.current(NOTE));

    expect(closeTabs).toHaveBeenCalledWith(["tab-0"]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports a backend denial instead of throwing", async () => {
    const error = new Error("path is outside the allowed workspaces and files: /etc/hosts");
    vi.mocked(invoke).mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = render({ tabs: [] });

    await act(() => result.current("/etc/hosts"));

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reopens the source tab when the backend refuses, so the note is not lost", async () => {
    // The close already flushed, so reopening restores the tab rather than
    // leaving the note showing in no window at all.
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const openFile = vi.fn(async () => "tab-reopened" as string | undefined);
    const { result } = render({ tabs: [openTab(NOTE)], closeTabs: async () => true, openFile });

    await act(() => result.current(NOTE));

    expect(openFile).toHaveBeenCalledWith(NOTE);
    consoleError.mockRestore();
  });

  it("does not reopen when the note was not open here to begin with", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const openFile = vi.fn(async () => "tab-reopened" as string | undefined);
    const { result } = render({ tabs: [], openFile });

    await act(() => result.current(NOTE));

    expect(openFile).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
