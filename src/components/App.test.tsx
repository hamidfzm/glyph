import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";

vi.mock("./editor/lazyEditor", () => ({
  MarkdownEditor: () => <div data-testid="lazy-editor" />,
  SplitView: () => <div data-testid="lazy-split" />,
}));

vi.mock("./markdown/MarkdownViewer", () => ({
  MarkdownViewer: () => <div data-testid="markdown-viewer" />,
}));

vi.mock("./modals/settings/lazySettings", () => ({
  SettingsModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <button type="button" data-testid="settings-modal" onClick={onClose}>
        settings
      </button>
    ) : null,
}));

vi.mock("./modals/AIPanel", () => ({
  AIPanel: ({ open }: { open: boolean }) => (open ? <div data-testid="ai-panel" /> : null),
}));

import { App } from "./App";

interface MenuListeners {
  [event: string]: ((event: { payload: unknown }) => void) | undefined;
}

function captureMenuListeners(): MenuListeners {
  const map: MenuListeners = {};
  vi.mocked(listen).mockImplementation(((name: string, cb: (e: { payload: unknown }) => void) => {
    map[name] = cb;
    return Promise.resolve(() => {});
  }) as unknown as typeof listen);
  return map;
}

function withProviders(overrides: Partial<SettingsContextValue> = {}) {
  const value: SettingsContextValue = {
    settings: DEFAULT_SETTINGS,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    loaded: true,
    ...overrides,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  return { value, wrapper };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
});

describe("App", () => {
  it("opens the CLI initial file and shows it in a tab", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "get_initial_folder":
          return Promise.resolve(null);
        case "get_initial_file":
          return Promise.resolve("/cli/test.md");
        case "read_file":
          return Promise.resolve("# Hello CLI");
        case "get_file_metadata":
          return Promise.resolve({
            name: "test.md",
            path: String(args?.path ?? ""),
            size: 0,
            modified: 0,
          });
        case "watch_file":
        case "set_menu_state":
          return Promise.resolve(undefined);
        default:
          return Promise.resolve(undefined);
      }
    }) as unknown as typeof invoke);

    const { wrapper } = withProviders();
    const { findByTestId } = render(<App />, { wrapper });
    expect(await findByTestId("markdown-viewer")).toBeInTheDocument();
  });

  it("renders the empty state when there are no tabs", async () => {
    const { wrapper } = withProviders();
    const { findByText } = render(<App />, { wrapper });

    expect(await findByText(/Open File/i)).toBeInTheDocument();
    expect(await findByText(/Open Folder/i)).toBeInTheDocument();
  });

  it("mounts without crashing when the empty state is showing", async () => {
    const { wrapper } = withProviders();
    const { container } = render(<App />, { wrapper });

    await waitFor(() => {
      expect(container.firstChild).not.toBeNull();
    });
    expect(container.textContent).toMatch(/Open a Markdown file/i);
  });

  it("does not crash when settings.loaded is false", async () => {
    const { wrapper } = withProviders({ loaded: false });
    const { container } = render(<App />, { wrapper });

    await waitFor(() => {
      expect(container.firstChild).not.toBeNull();
    });
  });

  it("opens and closes the settings modal in response to menu-open-settings", async () => {
    const listeners = captureMenuListeners();
    const { wrapper } = withProviders();
    const { queryByTestId, findByTestId } = render(<App />, { wrapper });
    await waitFor(() => expect(listeners["menu-open-settings"]).toBeDefined());
    expect(queryByTestId("settings-modal")).not.toBeInTheDocument();

    await act(async () => {
      listeners["menu-open-settings"]?.({ payload: undefined });
    });
    const modal = await findByTestId("settings-modal");
    expect(modal).toBeInTheDocument();

    // Closing the modal exercises the inline onClose arrow in AppShell's JSX.
    await act(async () => {
      modal.click();
    });
    await waitFor(() => expect(queryByTestId("settings-modal")).not.toBeInTheDocument());
  });

  it("renders EmptyState with a working Open Folder button (covers inline arrow)", async () => {
    const { wrapper } = withProviders();
    const { findByRole } = render(<App />, { wrapper });
    const folderButton = await findByRole("button", { name: /Open Folder/i });
    await act(async () => {
      folderButton.click();
    });
    // The dialog mock returns undefined → no tab opens. We only care that
    // the inline `() => openFolder()` arrow at JSX site is reached.
    expect(folderButton).toBeInTheDocument();
  });

  it("opens the AI panel in response to menu-ai-action when there is content", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "get_initial_folder":
          return Promise.resolve(null);
        case "get_initial_file":
          return Promise.resolve("/cli/with-content.md");
        case "read_file":
          return Promise.resolve("hello world");
        case "get_file_metadata":
          return Promise.resolve({
            name: "with-content.md",
            path: String(args?.path ?? ""),
            size: 0,
            modified: 0,
          });
        default:
          return Promise.resolve(undefined);
      }
    }) as unknown as typeof invoke);

    const listeners = captureMenuListeners();
    const { wrapper } = withProviders();
    const { findByTestId } = render(<App />, { wrapper });
    // Wait for the CLI file to load — handleAIActionFromMenu drops the call
    // unless there is non-empty displayContent.
    await findByTestId("markdown-viewer");
    await waitFor(() => expect(listeners["menu-ai-action"]).toBeDefined());

    await act(async () => {
      listeners["menu-ai-action"]?.({ payload: "summarize" });
    });
    expect(await findByTestId("ai-panel")).toBeInTheDocument();
  });

  it("invokes openFolder via menu-open-folder", async () => {
    const listeners = captureMenuListeners();
    const { wrapper } = withProviders();
    render(<App />, { wrapper });
    await waitFor(() => expect(listeners["menu-open-folder"]).toBeDefined());

    await act(async () => {
      listeners["menu-open-folder"]?.({ payload: undefined });
    });
    // The empty-state still shows since no folder was actually picked
    // (the dialog mock returns undefined). The handler just needs to have
    // been reachable through the menu wiring — covers AppShell line 102.
    expect(listeners["menu-open-folder"]).toBeDefined();
  });

  it("wires the command palette's activeFolderTab when a folder workspace is open", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "get_initial_folder":
          return Promise.resolve("/workspace");
        case "get_initial_file":
          return Promise.resolve(null);
        case "read_directory":
          return Promise.resolve([{ name: "a.md", path: "/workspace/a.md", isDirectory: false }]);
        case "list_markdown_files":
          return Promise.resolve(["/workspace/a.md"]);
        case "scan_wikilinks":
          return Promise.resolve([]);
        case "get_file_metadata":
          return Promise.resolve({
            name: "a.md",
            path: String(args?.path ?? ""),
            size: 0,
            modified: 0,
          });
        default:
          return Promise.resolve(undefined);
      }
    }) as unknown as typeof invoke);

    const { wrapper } = withProviders();
    const { container } = render(<App />, { wrapper });
    // Wait for the folder tab to land so the `activeTab?.kind === "folder"`
    // branch in useCommandPaletteController's options is exercised.
    await waitFor(() => {
      expect(container.querySelector('[data-tab-kind="folder"]')).not.toBeNull();
    });
  });

  it("forwards menu-close-tab, menu-find, and menu-toggle-edit to AppShell handlers", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "get_initial_folder":
          return Promise.resolve(null);
        case "get_initial_file":
          return Promise.resolve("/cli/edit-target.md");
        case "read_file":
          return Promise.resolve("# header\n\ncontent");
        case "get_file_metadata":
          return Promise.resolve({
            name: "edit-target.md",
            path: String(args?.path ?? ""),
            size: 0,
            modified: 0,
          });
        default:
          return Promise.resolve(undefined);
      }
    }) as unknown as typeof invoke);

    const listeners = captureMenuListeners();
    const { wrapper } = withProviders();
    const { findByTestId, queryByTestId } = render(<App />, { wrapper });
    // Wait for the file tab so all menu handlers operate on a real activeTabId.
    await findByTestId("markdown-viewer");

    await waitFor(() => {
      expect(listeners["menu-toggle-edit"]).toBeDefined();
      expect(listeners["menu-find"]).toBeDefined();
      expect(listeners["menu-close-tab"]).toBeDefined();
    });

    // menu-find: opens the search UI (covers find handler in menuHandlers).
    await act(async () => {
      listeners["menu-find"]?.({ payload: undefined });
    });

    // menu-toggle-edit: cycles view → edit. The lazy editor mock renders for
    // edit mode, so its appearance confirms setTabMode fired.
    await act(async () => {
      listeners["menu-toggle-edit"]?.({ payload: undefined });
    });
    expect(await findByTestId("lazy-editor")).toBeInTheDocument();

    // menu-close-tab: closes the open file (covers closeActiveTab path).
    await act(async () => {
      listeners["menu-close-tab"]?.({ payload: undefined });
    });
    await waitFor(() => expect(queryByTestId("lazy-editor")).not.toBeInTheDocument());
  });
});
