import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/tabs";
import type { DailyNote, DailyNotesSettings } from "@/lib/workspace";
import { deferred } from "@/test/deferred";
import { useDailyNote } from "./useDailyNote";

vi.mock("@tauri-apps/api/core");

const DEFAULTS: DailyNotesSettings = { folder: "daily", filenamePattern: "YYYY-MM-DD.md" };
const TODAY = "/ws/daily/2026-10-08.md";

function mockCommands(settings: DailyNotesSettings, note: Promise<DailyNote> | DailyNote) {
  vi.mocked(invoke).mockImplementation(((cmd: string) => {
    if (cmd === "workspace_get_daily_notes") return Promise.resolve(settings);
    if (cmd === "create_daily_note") return Promise.resolve(note);
    return Promise.reject(new Error(`unexpected command ${cmd}`));
  }) as typeof invoke);
}

function setup(root: string | null = "/ws") {
  const workspaceRef = { current: root ? ({ root } as Workspace) : null };
  const options = {
    workspaceRef,
    openFile: vi.fn(async () => "tab-1" as string | undefined),
    setTabMode: vi.fn(),
    refreshLoadedDirs: vi.fn(async () => {}),
    onWorkspaceNotice: vi.fn(),
  };
  const { result } = renderHook(() => useDailyNote(options));
  return { ...options, open: () => result.current.openDailyNote() };
}

const createCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "create_daily_note");

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  // Only the clock is faked, so promises and timers behave as usual.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 9, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDailyNote", () => {
  it("creates today's note, lists it, and opens it in edit mode", async () => {
    mockCommands(DEFAULTS, { path: TODAY, created: true });
    const hook = setup();

    await act(hook.open);

    expect(invoke).toHaveBeenCalledWith("create_daily_note", {
      root: "/ws",
      path: "daily/2026-10-08.md",
      template: null,
    });
    expect(hook.refreshLoadedDirs).toHaveBeenCalledWith("/ws");
    expect(hook.openFile).toHaveBeenCalledWith(TODAY);
    expect(hook.setTabMode).toHaveBeenCalledWith("tab-1", "edit");
    expect(hook.onWorkspaceNotice).not.toHaveBeenCalled();
  });

  it("passes the configured template along", async () => {
    mockCommands(
      { folder: "", filenamePattern: "DD-MM-YYYY", template: "templates/daily.md" },
      { path: "/ws/08-10-2026.md", created: true },
    );
    const hook = setup();

    await act(hook.open);

    expect(invoke).toHaveBeenCalledWith("create_daily_note", {
      root: "/ws",
      path: "08-10-2026.md",
      template: "templates/daily.md",
    });
  });

  it("opens a note that already exists as it is", async () => {
    mockCommands(DEFAULTS, { path: TODAY, created: false });
    const hook = setup();

    await act(hook.open);

    expect(hook.openFile).toHaveBeenCalledWith(TODAY);
    expect(hook.refreshLoadedDirs).not.toHaveBeenCalled();
    expect(hook.setTabMode).not.toHaveBeenCalled();
  });

  it("leaves the mode alone when the note opens in another window", async () => {
    mockCommands(DEFAULTS, { path: TODAY, created: true });
    const hook = setup();
    hook.openFile.mockResolvedValue(undefined);

    await act(hook.open);

    expect(hook.setTabMode).not.toHaveBeenCalled();
  });

  it("does nothing without a workspace", async () => {
    const hook = setup(null);

    await act(hook.open);

    expect(invoke).not.toHaveBeenCalled();
    expect(hook.openFile).not.toHaveBeenCalled();
  });

  it("surfaces a backend failure instead of opening anything", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "workspace_get_daily_notes"
        ? Promise.resolve({ ...DEFAULTS, template: "templates/gone.md" })
        : Promise.reject("Failed to read the daily note template")) as typeof invoke);
    const hook = setup();

    await act(hook.open);

    expect(hook.onWorkspaceNotice).toHaveBeenCalledWith({
      key: "dailyNote.failed",
      values: { error: "Failed to read the daily note template" },
    });
    expect(hook.openFile).not.toHaveBeenCalled();
  });

  it("surfaces unreadable settings", async () => {
    vi.mocked(invoke).mockRejectedValue("corrupt .glyph/config.json");
    const hook = setup();

    await act(hook.open);

    expect(hook.onWorkspaceNotice).toHaveBeenCalledWith({
      key: "dailyNote.failed",
      values: { error: "corrupt .glyph/config.json" },
    });
    expect(createCalls()).toHaveLength(0);
  });

  it.each([
    ["patternRequired", { folder: "daily", filenamePattern: "" }],
    ["invalidPath", { folder: "../outside", filenamePattern: "YYYY-MM-DD.md" }],
  ])(
    "refuses hand-edited settings with a %s problem before creating",
    async (problem, settings) => {
      mockCommands(settings, { path: TODAY, created: true });
      const hook = setup();

      await act(hook.open);

      expect(hook.onWorkspaceNotice).toHaveBeenCalledWith({ key: `dailyNote.${problem}` });
      expect(createCalls()).toHaveLength(0);
      expect(hook.openFile).not.toHaveBeenCalled();
    },
  );

  it("ignores a repeat while a request is still in flight", async () => {
    const note = deferred<DailyNote>();
    mockCommands(DEFAULTS, note.promise);
    const hook = setup();

    let first: Promise<void> | undefined;
    await act(async () => {
      first = hook.open();
      await hook.open();
    });
    await act(async () => {
      note.resolve({ path: TODAY, created: true });
      await first;
    });

    expect(createCalls()).toHaveLength(1);
    expect(hook.openFile).toHaveBeenCalledOnce();
  });

  it("accepts a new request once the previous one settled, even after a failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("disk full");
    const hook = setup();
    await act(hook.open);

    mockCommands(DEFAULTS, { path: TODAY, created: false });
    await act(hook.open);

    expect(hook.openFile).toHaveBeenCalledWith(TODAY);
  });

  it("does not open the note of a workspace that was closed meanwhile", async () => {
    const note = deferred<DailyNote>();
    mockCommands(DEFAULTS, note.promise);
    const hook = setup();

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = hook.open();
    });
    hook.workspaceRef.current = { root: "/other" } as Workspace;
    await act(async () => {
      note.resolve({ path: TODAY, created: true });
      await pending;
    });

    expect(hook.openFile).not.toHaveBeenCalled();
    expect(hook.setTabMode).not.toHaveBeenCalled();
  });
});
