import type { load } from "@tauri-apps/plugin-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import type { Settings } from "@/lib/settings";
import { mockedLoad, resetSettingsDom, TestConsumer } from "@/test/settingsHarness";

// Every window loads and writes the same settings.json. A window writes the
// whole blob from its own React snapshot, so without a merge its stale copy of
// a key another window just changed would land back on disk and undo it. These
// drive that race directly: the store's contents change *between* the load and
// the write, standing in for the other window.

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
});

/**
 * A store whose contents can be rewritten mid-test, so `get` returns what is
 * "on disk" at the moment it is called rather than a fixed snapshot.
 */
function mockLiveStore(initial: Partial<Settings>) {
  let contents: Partial<Settings> = initial;
  // Lets a test hold a write open inside `save()` so an update can land while
  // it is still in flight, which is the only way to reach the mid-write races.
  let releaseSave: (() => void) | null = null;
  const get = vi.fn(async () => contents);
  const set = vi.fn(async (_key: string, value: Partial<Settings>) => {
    contents = value;
  });
  const save = vi.fn(async () => {
    if (!releaseSave) return;
    const gate = new Promise<void>((resolve) => {
      const pendingRelease = releaseSave;
      releaseSave = () => {
        pendingRelease?.();
        resolve();
      };
    });
    await gate;
  });
  mockedLoad.mockResolvedValueOnce({ get, set, save } as unknown as Awaited<
    ReturnType<typeof load>
  >);
  return {
    get,
    set,
    save,
    /** Stand in for another window persisting a change. */
    writeFromAnotherWindow(next: Partial<Settings>) {
      contents = next;
    },
    /** Hold the next `save()` open until `releaseWrite` is called. */
    blockWrite() {
      releaseSave = () => {};
    },
    releaseWrite() {
      const release = releaseSave;
      releaseSave = null;
      release?.();
    },
    current: () => contents,
  };
}

async function renderLoaded() {
  render(
    <SettingsProvider>
      <TestConsumer />
    </SettingsProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId("loaded").textContent).toBe("true");
  });
}

describe("SettingsProvider across windows", () => {
  it("keeps a key another window changed while writing its own", async () => {
    const store = mockLiveStore({
      appearance: { fontSize: 16, theme: "system" },
    } as Partial<Settings>);
    await renderLoaded();

    // Another window switches the theme after this one loaded, so this
    // window's snapshot still says "system".
    store.writeFromAnotherWindow({
      appearance: { fontSize: 16, theme: "dark" },
    } as Partial<Settings>);

    act(() => screen.getByTestId("change-font").click());
    await waitFor(() => {
      expect(store.set).toHaveBeenCalled();
    });

    const written = store.set.mock.lastCall?.[1] as Settings;
    expect(written.appearance.fontSize).toBe(20);
    expect(written.appearance.theme).toBe("dark");
  });

  it("does not resurrect a key this window never touched", async () => {
    const store = mockLiveStore({
      layout: { filesSidebarVisible: true },
    } as Partial<Settings>);
    await renderLoaded();

    store.writeFromAnotherWindow({
      layout: { filesSidebarVisible: false },
    } as Partial<Settings>);

    act(() => screen.getByTestId("change-theme").click());
    await waitFor(() => {
      expect(store.set).toHaveBeenCalled();
    });

    const written = store.set.mock.lastCall?.[1] as Settings;
    expect(written.appearance.theme).toBe("dark");
    expect(written.layout.filesSidebarVisible).toBe(false);
  });

  it("replaces every key on reset, including ones another window changed", async () => {
    const store = mockLiveStore({
      appearance: { fontSize: 16, theme: "system" },
    } as Partial<Settings>);
    await renderLoaded();

    store.writeFromAnotherWindow({
      appearance: { fontSize: 30, theme: "dark" },
    } as Partial<Settings>);

    act(() => screen.getByTestId("reset").click());
    await waitFor(() => {
      expect(store.set).toHaveBeenCalled();
    });

    // Reset means defaults, not a merge over whatever the other window left.
    const written = store.set.mock.lastCall?.[1] as Settings;
    expect(written.appearance.theme).toBe("system");
    expect(written.appearance.fontSize).not.toBe(30);
  });

  it("stops replacing wholesale once the reset is on disk", async () => {
    // A newer update arriving *while the reset write is in flight* used to
    // leave the replace-all flag set, so the very next write skipped the merge
    // and clobbered the other window.
    const store = mockLiveStore({
      appearance: { fontSize: 16, theme: "system" },
    } as Partial<Settings>);
    await renderLoaded();

    store.blockWrite();
    act(() => screen.getByTestId("reset").click());
    // The reset has written the defaults and is now parked inside save().
    await waitFor(() => {
      expect(store.save).toHaveBeenCalled();
    });

    // The other window turns the sidebar off, on top of the reset's defaults.
    store.writeFromAnotherWindow({
      ...store.current(),
      layout: { ...store.current().layout, filesSidebarVisible: false },
    } as Partial<Settings>);

    // A newer update lands while the reset write is still parked.
    act(() => screen.getByTestId("change-theme").click());
    store.releaseWrite();

    // The write that follows must merge, not replace.
    await waitFor(() => {
      expect(store.set.mock.calls.length).toBeGreaterThan(1);
    });
    const written = store.set.mock.lastCall?.[1] as Settings;
    expect(written.appearance.theme).toBe("dark");
    expect(written.layout.filesSidebarVisible).toBe(false);
  });

  it("merges both windows' changes when each edits a different key", async () => {
    const store = mockLiveStore({
      appearance: { fontSize: 16, theme: "system" },
    } as Partial<Settings>);
    await renderLoaded();

    act(() => screen.getByTestId("change-theme").click());
    await waitFor(() => {
      expect(store.set).toHaveBeenCalledTimes(1);
    });

    // The other window writes its own change on top of ours...
    store.writeFromAnotherWindow({
      ...store.current(),
      appearance: { ...store.current().appearance, fontSize: 24 },
    } as Partial<Settings>);

    // ...and our next write must not roll it back.
    act(() => screen.getByTestId("change-font").click());
    await waitFor(() => {
      expect(store.set).toHaveBeenCalledTimes(2);
    });

    const written = store.set.mock.lastCall?.[1] as Settings;
    expect(written.appearance.theme).toBe("dark");
    expect(written.appearance.fontSize).toBe(20);
  });
});
