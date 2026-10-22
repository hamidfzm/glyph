import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "@/hooks/useAutoSave";
import { autoSaveDocuments } from "@/lib/autoSaveDocuments";
import { pickSave } from "@/lib/pickers";
import { deferred } from "@/test/deferred";
import {
  defaultOptions,
  fileOf,
  type Invoker,
  makeInvoker,
  openEditable,
  resetTabsMocks,
  type TabsHook,
} from "@/test/tabsHarness";
import { useTabs } from "./useTabs";

vi.mock("@/lib/pickers", () => ({
  pickFolder: vi.fn(),
  pickFiles: vi.fn(),
  pickSave: vi.fn(),
  pickNewWorkspace: vi.fn(),
}));

const DEBOUNCE = 2000;

beforeEach(resetTabsMocks);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Auto Save wired as AppShell wires it, with the setting on.
function useTabsWithAutoSave() {
  const tabs = useTabs(defaultOptions());
  useAutoSave({ documents: autoSaveDocuments(tabs.tabs), save: tabs.saveDocument });
  return tabs;
}

function mockWrites(writeFile: ReturnType<typeof vi.fn>) {
  vi.mocked(invoke).mockImplementation(
    makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
  );
}

async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** Type `text` into a new untitled document, with the clock faked from its first edit. */
async function typeIntoNewDocument(result: TabsHook, text: string) {
  await waitFor(() => expect(result.current.initializing).toBe(false));
  vi.useFakeTimers();
  act(() => {
    result.current.newDocument();
  });
  const tabId = result.current.tabs[0].id;
  act(() => {
    result.current.updateEditContent(tabId, text);
  });
  return tabId;
}

describe("Auto Save and untitled documents", () => {
  it("opens no Save As for an untitled document, however long it is left alone", async () => {
    const { result } = renderHook(useTabsWithAutoSave);
    const tabId = await typeIntoNewDocument(result, "draft");

    await wait(DEBOUNCE * 5);
    act(() => {
      result.current.updateEditContent(tabId, "draft more");
    });
    await wait(DEBOUNCE * 5);

    expect(pickSave).not.toHaveBeenCalled();
    expect(fileOf(result).virtual).toBe(true);
    expect(fileOf(result).dirty).toBe(true);
  });

  it("Save inside the debounce opens one Save As, and Auto Save adds none", async () => {
    const dialog = deferred<string | null>();
    vi.mocked(pickSave).mockReturnValue(dialog.promise);
    const { result } = renderHook(useTabsWithAutoSave);
    const tabId = await typeIntoNewDocument(result, "draft");

    let saving: Promise<boolean> | undefined;
    act(() => {
      saving = result.current.saveDocument(tabId);
    });
    await wait(DEBOUNCE * 2);
    expect(pickSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      dialog.resolve(null);
      await saving;
    });
    act(() => {
      result.current.updateEditContent(tabId, "draft more");
    });
    await wait(DEBOUNCE * 2);

    // The cancelled dialog does not come back on its own after the next edit.
    expect(pickSave).toHaveBeenCalledTimes(1);
    expect(fileOf(result).dirty).toBe(true);
  });

  it("saves the document once Save As gave it a path, an edit made during that write included", async () => {
    const writeStarted = deferred();
    const writeGate = deferred();
    const writeFile = vi
      .fn()
      .mockImplementationOnce(async () => {
        writeStarted.resolve();
        await writeGate.promise;
      })
      .mockResolvedValue(undefined);
    mockWrites(writeFile);
    vi.mocked(pickSave).mockResolvedValue("/p/saved.md");
    const { result } = renderHook(useTabsWithAutoSave);
    const tabId = await typeIntoNewDocument(result, "first");

    let saving: Promise<boolean> | undefined;
    await act(async () => {
      saving = result.current.saveDocument(tabId);
      await writeStarted.promise;
    });
    act(() => {
      result.current.updateEditContent(tabId, "first second");
    });
    await act(async () => {
      writeGate.resolve();
      await saving;
    });
    expect(fileOf(result).dirty).toBe(true);

    await wait(DEBOUNCE);
    expect(writeFile).toHaveBeenLastCalledWith("write_file", {
      path: "/p/saved.md",
      content: "first second",
    });
    expect(fileOf(result).dirty).toBe(false);

    act(() => {
      result.current.updateEditContent(tabId, "first second third");
    });
    await wait(DEBOUNCE);
    expect(writeFile).toHaveBeenLastCalledWith("write_file", {
      path: "/p/saved.md",
      content: "first second third",
    });
    expect(writeFile).toHaveBeenCalledTimes(3);
    expect(pickSave).toHaveBeenCalledTimes(1);
  });

  it("still saves a document with a path once per pause in typing", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWrites(writeFile);
    const { result } = renderHook(useTabsWithAutoSave);
    const tabId = await openEditable(result);
    vi.useFakeTimers();

    act(() => {
      result.current.updateEditContent(tabId, "one");
    });
    await wait(DEBOUNCE / 2);
    act(() => {
      result.current.updateEditContent(tabId, "one two");
    });
    await wait(DEBOUNCE / 2);
    expect(writeFile).not.toHaveBeenCalled();

    await wait(DEBOUNCE / 2);
    expect(writeFile).toHaveBeenCalledExactlyOnceWith("write_file", {
      path: "/p/a.md",
      content: "one two",
    });
    await wait(DEBOUNCE * 2);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(fileOf(result).dirty).toBe(false);
  });
});
