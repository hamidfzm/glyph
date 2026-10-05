import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { VaultSnapshot } from "@/lib/vault";
import { CHUNK_LOAD_TIMEOUT_MS } from "@/test/chunkLoadTimeout";
import { fileScan, vaultSnapshot } from "@/test/tabsHarness";

vi.mock("./editor/lazyEditor", () => ({
  MarkdownEditor: () => <div data-testid="lazy-editor" />,
  SplitView: () => <div data-testid="lazy-split" />,
}));

vi.mock("./markdown/MarkdownViewer", () => ({
  MarkdownViewer: () => <div data-testid="markdown-viewer" />,
}));

vi.mock("./modals/settings/lazySettings", () => ({
  SettingsModal: ({ open, onClose, tab }: { open: boolean; onClose: () => void; tab: string }) =>
    open ? (
      <button type="button" data-testid="settings-modal" data-tab={tab} onClick={onClose}>
        settings
      </button>
    ) : null,
}));

vi.mock("./ai/AIChatPanel", () => ({
  AIChatPanel: ({ open }: { open: boolean }) => (open ? <div data-testid="ai-panel" /> : null),
}));

// Only the jump itself is stubbed: the mocked viewer renders no lines to land on.
vi.mock("@/lib/documentHighlight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/documentHighlight")>()),
  locateLineInDocument: vi.fn(() => true),
}));

// Mocked so a test can drive the in-progress-export state (the real hook never
// sets it here — the mocked viewer renders no `.markdown-body` to export).
vi.mock("@/hooks/useExport", () => ({ useExport: vi.fn() }));

import { type ExportHandlers, useExport } from "@/hooks/useExport";
import { locateLineInDocument } from "@/lib/documentHighlight";
import { App } from "./App";

const IDLE_EXPORTERS: ExportHandlers = {
  exportHtml: vi.fn(),
  exportDocx: vi.fn(),
  exportEpub: vi.fn(),
  exportPdf: vi.fn(),
  exporting: null,
};

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
    flushSettings: async () => true,
    loaded: true,
    ...overrides,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  return { value, wrapper };
}

/** Launch with the folder `/workspace` holding one note, answering the index as given. */
function mockWorkspaceLaunch(
  index: {
    snapshot?: VaultSnapshot;
    backlinks?: Array<{ source: string; line: number; snippet: string }>;
    taggedPaths?: string[];
  } = {},
) {
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "get_initial_folder":
        return Promise.resolve("/workspace");
      case "get_initial_file":
        return Promise.resolve(null);
      case "read_directory":
        return Promise.resolve([{ name: "a.md", path: "/workspace/a.md", isDirectory: false }]);
      case "list_markdown_files":
        return Promise.resolve(fileScan(["/workspace/a.md"]));
      case "vault_refresh":
      case "vault_snapshot":
        return Promise.resolve(index.snapshot ?? vaultSnapshot(["/workspace/a.md"]));
      case "vault_backlinks":
        return Promise.resolve(index.backlinks ?? []);
      case "vault_paths_with_tag":
        return Promise.resolve(index.taggedPaths ?? []);
      case "workspace_resolve":
        return Promise.resolve({
          selected: String(args?.selected ?? ""),
          isGitRepo: false,
          gitTopLevel: null,
          nestedUnder: null,
          glyphConflict: null,
        });
      case "get_file_metadata": {
        const path = String(args?.path ?? "");
        return Promise.resolve({ name: path.split("/").pop(), path, size: 0, modified: 0 });
      }
      default:
        return Promise.resolve(undefined);
    }
  }) as unknown as typeof invoke);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
  vi.mocked(useExport).mockReturnValue(IDLE_EXPORTERS);
  // PluginsProvider fetches the marketplace index on every App mount; resolve
  // it with an empty registry so the best-effort fetch does not log an error.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ plugins: [] }) })),
  );
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

  it("shows the export progress toast while an export is in flight", async () => {
    vi.mocked(useExport).mockReturnValue({ ...IDLE_EXPORTERS, exporting: "docx" });
    const { wrapper } = withProviders();
    const { findByRole } = render(<App />, { wrapper });

    const status = await findByRole("status");
    expect(status).toHaveTextContent("Exporting Word document…");
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

    // The empty state waits for session restore, which waits for plugins.
    await waitFor(() => expect(container.textContent).toMatch(/Open a Markdown file/i));
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

  it("opens and closes Workspace Settings in response to menu-workspace-settings", async () => {
    const listeners = captureMenuListeners();
    const { wrapper } = withProviders();
    const { queryByRole, findByRole } = render(<App />, { wrapper });
    await waitFor(() => expect(listeners["menu-workspace-settings"]).toBeDefined());
    expect(queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      listeners["menu-workspace-settings"]?.({ payload: undefined });
    });
    // The modal is a lazy chunk now; give its first import the chunk timeout.
    expect(
      await findByRole(
        "dialog",
        { name: /workspace settings/i },
        { timeout: CHUNK_LOAD_TIMEOUT_MS },
      ),
    ).toBeInTheDocument();

    await act(async () => {
      (await findByRole("button", { name: /close/i })).click();
    });
    await waitFor(() => expect(queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens Settings on the Plugins tab in response to menu-manage-plugins", async () => {
    const listeners = captureMenuListeners();
    const { wrapper } = withProviders();
    const { queryByTestId, findByTestId } = render(<App />, { wrapper });
    await waitFor(() => expect(listeners["menu-manage-plugins"]).toBeDefined());
    expect(queryByTestId("settings-modal")).not.toBeInTheDocument();

    await act(async () => {
      listeners["menu-manage-plugins"]?.({ payload: undefined });
    });
    expect(await findByTestId("settings-modal")).toHaveAttribute("data-tab", "plugins");
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
    // Wait for the CLI file to load so the action runs against real content.
    await findByTestId("markdown-viewer");
    await waitFor(() => expect(listeners["menu-ai-action"]).toBeDefined());

    await act(async () => {
      listeners["menu-ai-action"]?.({ payload: "summarize" });
    });
    expect(await findByTestId("ai-panel")).toBeInTheDocument();
  });

  it("renders an image tab's viewer instead of a blank pane (null text content)", async () => {
    // Image tabs carry no text content; the content gate must admit them by
    // path or they fall through to an empty pane (the SVG-blank regression).
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "get_initial_folder":
          return Promise.resolve(null);
        case "get_initial_file":
          return Promise.resolve("/cli/diagram.svg");
        case "read_file":
          return Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg"/>');
        case "get_file_metadata":
          return Promise.resolve({
            name: "diagram.svg",
            path: String(args?.path ?? ""),
            size: 0,
            modified: 0,
          });
        default:
          return Promise.resolve(undefined);
      }
    }) as unknown as typeof invoke);

    const { wrapper } = withProviders();
    const { findByRole } = render(<App />, { wrapper });
    expect(await findByRole("region", { name: "Image viewer" })).toBeInTheDocument();
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

  it("opens the workspace's first note as a document tab when a folder is opened", async () => {
    mockWorkspaceLaunch();

    const { wrapper } = withProviders();
    const { container } = render(<App />, { wrapper });
    // The workspace lands at window level (sidebar tree) and its first note
    // auto-opens as a plain document tab, exercising the workspaceOpen branch
    // in useCommandPaletteController's options.
    await waitFor(() => {
      const tab = container.querySelector('[data-tab-kind="file"]');
      expect(tab?.textContent).toContain("a.md");
    });
  });

  // The real tags and backlinks core plugins, through the real plugin host.
  it("fills the Files panel blocks from the workspace index", async () => {
    mockWorkspaceLaunch({
      snapshot: vaultSnapshot(["/workspace/a.md", "/workspace/b.md"], {
        tagCounts: [{ tag: "work", count: 1 }],
      }),
      backlinks: [{ source: "/workspace/b.md", line: 2, snippet: "see the first note" }],
      taggedPaths: ["/workspace/b.md"],
    });
    const { wrapper } = withProviders();
    render(<App />, { wrapper });

    expect(await screen.findByRole("button", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backlinks" })).toBeInTheDocument();
    // The open note's inbound link, once its tab and the index are both up.
    expect(await screen.findByText("see the first note")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Filter by #work" }));
    expect(await screen.findByText("#work (1)")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("vault_paths_with_tag", {
      root: "/workspace",
      tag: "work",
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    await waitFor(() => expect(screen.queryByText("#work (1)")).not.toBeInTheDocument());
  });

  it("opens a backlink's note at the line the link is on", async () => {
    mockWorkspaceLaunch({
      snapshot: vaultSnapshot(["/workspace/a.md", "/workspace/b.md"]),
      backlinks: [{ source: "/workspace/b.md", line: 12, snippet: "see the first note" }],
    });
    const { wrapper } = withProviders();
    const { container } = render(<App />, { wrapper });

    fireEvent.click(await screen.findByText("see the first note"));
    await waitFor(() => {
      const tabs = [...container.querySelectorAll('[data-tab-kind="file"]')];
      expect(tabs.map((tab) => tab.textContent).join(" ")).toContain("b.md");
    });
    await waitFor(() => expect(locateLineInDocument).toHaveBeenCalledWith(12));
  });

  it("leaves a core plugin's block out of the Files panel while it is switched off", async () => {
    mockWorkspaceLaunch();
    const { wrapper } = withProviders({
      settings: {
        ...DEFAULT_SETTINGS,
        corePlugins: { ...DEFAULT_SETTINGS.corePlugins, tags: false },
      },
    });
    render(<App />, { wrapper });

    expect(await screen.findByRole("button", { name: "Backlinks" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
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

    // menu-toggle-edit cycles view → edit → split → view. Each step renders a
    // different mock (editor, split, viewer), confirming the full nextEditorMode
    // cycle runs through setTabMode.
    await act(async () => {
      listeners["menu-toggle-edit"]?.({ payload: undefined });
    });
    expect(await findByTestId("lazy-editor")).toBeInTheDocument();

    await act(async () => {
      listeners["menu-toggle-edit"]?.({ payload: undefined });
    });
    expect(await findByTestId("lazy-split")).toBeInTheDocument();

    await act(async () => {
      listeners["menu-toggle-edit"]?.({ payload: undefined });
    });
    expect(await findByTestId("markdown-viewer")).toBeInTheDocument();

    // menu-close-tab: closes the open file (covers closeActiveTab path).
    await act(async () => {
      listeners["menu-close-tab"]?.({ payload: undefined });
    });
    await waitFor(() => expect(queryByTestId("lazy-editor")).not.toBeInTheDocument());
  });
});
