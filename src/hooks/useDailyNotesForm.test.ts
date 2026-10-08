import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyNotesSettings } from "@/lib/workspace";
import { mockStoredDailyNotes } from "@/test/dailyNotes";
import { deferred } from "@/test/deferred";
import { useDailyNotesForm } from "./useDailyNotesForm";

vi.mock("@tauri-apps/api/core");

const DEFAULTS: DailyNotesSettings = { folder: "daily", filenamePattern: "YYYY-MM-DD.md" };
const OCT_8 = new Date(2026, 9, 8);

async function loadedForm(settings: DailyNotesSettings = DEFAULTS) {
  mockStoredDailyNotes(settings);
  const view = renderHook(() => useDailyNotesForm("/ws"));
  await waitFor(() => expect(view.result.current.form).not.toBeNull());
  return view;
}

const saveCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "workspace_set_daily_notes");

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useDailyNotesForm", () => {
  it("loads the stored settings, showing a missing template as blank", async () => {
    const { result } = await loadedForm();

    expect(invoke).toHaveBeenCalledWith("workspace_get_daily_notes", { workspaceRoot: "/ws" });
    expect(result.current.form).toEqual({ ...DEFAULTS, template: "" });
    expect(result.current.error).toBeNull();
  });

  it("refuses to save without a workspace, and reads nothing", async () => {
    const { result } = renderHook(() => useDailyNotesForm(undefined));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  // Saving before the load finished would write defaults over real settings.
  it("refuses to save until the stored settings have loaded", async () => {
    const stored = deferred<DailyNotesSettings>();
    vi.mocked(invoke).mockReturnValue(stored.promise as never);
    const { result } = renderHook(() => useDailyNotesForm("/ws"));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(false);
    expect(result.current.previewPath(OCT_8)).toBeNull();
    expect(saveCalls()).toHaveLength(0);
  });

  it("ignores an edit made before the stored settings have loaded", async () => {
    const stored = deferred<DailyNotesSettings>();
    vi.mocked(invoke).mockReturnValue(stored.promise as never);
    const { result } = renderHook(() => useDailyNotesForm("/ws"));

    act(() => result.current.update("folder", "typed too early"));
    expect(result.current.form).toBeNull();

    await act(async () => {
      stored.resolve(DEFAULTS);
    });
    expect(result.current.form?.folder).toBe("daily");
  });

  it("surfaces a load failure and keeps the form closed", async () => {
    vi.mocked(invoke).mockRejectedValue("corrupt .glyph/config.json");
    const { result } = renderHook(() => useDailyNotesForm("/ws"));

    await waitFor(() => expect(result.current.error).toBe("corrupt .glyph/config.json"));
    expect(result.current.form).toBeNull();
  });

  it("saves the edited values in their stored form", async () => {
    const { result } = await loadedForm();
    act(() => {
      result.current.update("folder", "\\journal\\");
      result.current.update("filenamePattern", " DD-MM-YYYY ");
      result.current.update("template", "templates\\daily.md");
    });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(true);
    expect(invoke).toHaveBeenCalledWith("workspace_set_daily_notes", {
      workspaceRoot: "/ws",
      settings: {
        folder: "journal",
        filenamePattern: "DD-MM-YYYY",
        template: "templates/daily.md",
      },
    });
  });

  it("stores no template when the field is cleared", async () => {
    const { result } = await loadedForm({ ...DEFAULTS, template: "templates/daily.md" });
    act(() => result.current.update("template", ""));

    await act(async () => {
      await result.current.save();
    });

    expect(saveCalls()[0][1]).toEqual({
      workspaceRoot: "/ws",
      settings: { ...DEFAULTS, template: undefined },
    });
  });

  it.each([
    ["an empty pattern", "filenamePattern", "", /enter a file name pattern/i],
    ["a folder outside the workspace", "folder", "../elsewhere", /can't contain/i],
  ] as const)("refuses %s with a message, writing nothing", async (_name, key, value, message) => {
    const { result } = await loadedForm();
    act(() => result.current.update(key, value));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(false);
    expect(result.current.error).toMatch(message);
    expect(result.current.previewPath(OCT_8)).toBeNull();
    expect(saveCalls()).toHaveLength(0);
  });

  it("surfaces a write failure", async () => {
    const { result } = await loadedForm();
    vi.mocked(invoke).mockRejectedValue("failed to write .glyph/config.json");

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(false);
    expect(result.current.error).toBe("failed to write .glyph/config.json");
  });

  it("previews the path the edited values give a day's note", async () => {
    const { result } = await loadedForm();
    expect(result.current.previewPath(OCT_8)).toBe("daily/2026-10-08.md");

    act(() => result.current.update("filenamePattern", "YYYY/MM/[day] D"));
    expect(result.current.previewPath(OCT_8)).toBe("daily/2026/10/day 8.md");
  });

  it("shows the new workspace's settings when an older load finishes last", async () => {
    const first = deferred<DailyNotesSettings>();
    vi.mocked(invoke).mockImplementation(((_cmd: string, args: { workspaceRoot: string }) =>
      args.workspaceRoot === "/first"
        ? first.promise
        : Promise.resolve({ folder: "second", filenamePattern: "DD.md" })) as typeof invoke);
    const { result, rerender } = renderHook(({ root }) => useDailyNotesForm(root), {
      initialProps: { root: "/first" },
    });

    rerender({ root: "/second" });
    await waitFor(() => expect(result.current.form?.folder).toBe("second"));
    await act(async () => {
      first.resolve({ folder: "first", filenamePattern: "YYYY.md" });
    });

    expect(result.current.form?.folder).toBe("second");
  });

  it("keeps an older workspace's load failure off the new workspace's form", async () => {
    const first = deferred<DailyNotesSettings>();
    vi.mocked(invoke).mockImplementation(((_cmd: string, args: { workspaceRoot: string }) =>
      args.workspaceRoot === "/first"
        ? first.promise
        : Promise.resolve({ folder: "second", filenamePattern: "DD.md" })) as typeof invoke);
    const { result, rerender } = renderHook(({ root }) => useDailyNotesForm(root), {
      initialProps: { root: "/first" },
    });

    rerender({ root: "/second" });
    await waitFor(() => expect(result.current.form?.folder).toBe("second"));
    await act(async () => {
      first.reject("corrupt .glyph/config.json");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.form?.folder).toBe("second");
  });
});
