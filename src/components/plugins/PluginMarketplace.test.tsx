import { openUrl } from "@tauri-apps/plugin-opener";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import type { RegistryEntry } from "@/lib/plugins/marketplace";
import { createRegistry } from "@/lib/plugins/registry";
import type {
  CommandContribution,
  ExporterContribution,
  FencedRendererContribution,
  MarkdownPlugin,
  SettingsPanelContribution,
  SidebarPanelContribution,
  StatusBarItemContribution,
  StyleContribution,
} from "@/lib/plugins/types";
import { PluginMarketplace } from "./PluginMarketplace";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: "com.x.demo",
    name: "Demo",
    description: "from the market",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    packageUrl: "https://example.test/demo.zip",
    sha256: "aa",
    category: "tools",
    ...over,
  };
}

function ctx(over: Partial<PluginsContextValue> = {}): PluginsContextValue {
  return {
    commands: createRegistry<CommandContribution>(),
    statusBarItems: createRegistry<StatusBarItemContribution>(),
    remarkPlugins: createRegistry<MarkdownPlugin>(),
    rehypePlugins: createRegistry<MarkdownPlugin>(),
    fencedRenderers: createRegistry<FencedRendererContribution>(),
    sidebarPanels: createRegistry<SidebarPanelContribution>(),
    settingsPanels: createRegistry<SettingsPanelContribution>(),
    styles: createRegistry<StyleContribution>(),
    exporters: createRegistry<ExporterContribution>(),
    siteThemes: createRegistry(),
    installed: [],
    disabled: [],
    loaded: [],
    registry: [
      entry(),
      entry({
        id: "com.x.dict",
        name: "Dictionary",
        category: "language",
        official: true,
        keywords: ["farsi"],
      }),
    ],
    updates: [],
    installFromFolder: vi.fn(async () => {}),
    installFromRegistry: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    setWorkspaceRoot: vi.fn(),
    initialLoadDone: true,
    ...over,
  };
}

function renderMarket(value = ctx()) {
  render(
    <PluginsContext.Provider value={value}>
      <PluginMarketplace />
    </PluginsContext.Provider>,
  );
  return value;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("# Demo readme") }),
  );
  return () => vi.unstubAllGlobals();
});

describe("PluginMarketplace", () => {
  it("lists entries with the official badge where declared", () => {
    renderMarket();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Dictionary")).toBeInTheDocument();
    expect(screen.getAllByText("Official")).toHaveLength(1);
  });

  it("filters by search text, matching keywords too", () => {
    renderMarket();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "farsi" } });
    expect(screen.queryByText("Demo")).not.toBeInTheDocument();
    expect(screen.getByText("Dictionary")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing-matches" } });
    expect(screen.getByText("No plugins available.")).toBeInTheDocument();
  });

  it("filters by category", () => {
    renderMarket();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "language" } });
    expect(screen.queryByText("Demo")).not.toBeInTheDocument();
    expect(screen.getByText("Dictionary")).toBeInTheDocument();
  });

  it("hides installed plugins from the listing", () => {
    renderMarket(
      ctx({
        installed: [
          {
            id: "com.x.demo",
            name: "Demo",
            version: "1.0.0",
            apiVersion: PLUGIN_API_VERSION,
            dir: "/p",
            mainSource: "",
          },
        ],
      }),
    );
    expect(screen.queryByText("Demo")).not.toBeInTheDocument();
    expect(screen.getByText("Dictionary")).toBeInTheDocument();
  });

  it("installs from the row button", () => {
    const value = renderMarket();
    fireEvent.click(screen.getAllByRole("button", { name: "Install" })[0]);
    expect(value.installFromRegistry).toHaveBeenCalled();
  });

  it("opens the details view with the fetched README and returns via Back", async () => {
    renderMarket();
    fireEvent.click(screen.getByText("Dictionary"));
    expect(await screen.findByText("Demo readme")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("installs from the details view and leaves it", async () => {
    const value = renderMarket();
    fireEvent.click(screen.getByText("Dictionary"));
    await screen.findByText("Demo readme");
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(value.installFromRegistry).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("searchbox")).toBeInTheDocument());
  });

  it("renders nothing without a PluginsProvider", () => {
    const { container } = render(<PluginMarketplace />);
    expect(container.firstChild).toBeNull();
  });

  it("opens README links externally instead of navigating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("[docs](https://example.test/docs)"),
      }),
    );
    renderMarket();
    fireEvent.click(screen.getByText("Dictionary"));
    fireEvent.click(await screen.findByRole("link", { name: "docs" }));
    expect(vi.mocked(openUrl)).toHaveBeenCalledWith("https://example.test/docs");

    // An opener failure is swallowed, not surfaced.
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("no handler"));
    fireEvent.click(screen.getByRole("link", { name: "docs" }));
    await waitFor(() => expect(vi.mocked(openUrl)).toHaveBeenCalledTimes(2));
  });

  it("ignores a README failure that lands after leaving the details view", async () => {
    let rejectFetch!: (reason: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
      ),
    );
    renderMarket();
    fireEvent.click(screen.getByText("Dictionary"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    rejectFetch(new Error("offline"));
    await waitFor(() => expect(screen.getByRole("searchbox")).toBeInTheDocument());
    expect(screen.queryByText("Could not load the plugin details.")).not.toBeInTheDocument();
  });

  it("ignores a README response that lands after leaving the details view", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );
    renderMarket();
    fireEvent.click(screen.getByText("Dictionary"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    resolveFetch({ ok: true, text: () => Promise.resolve("# late") });
    await waitFor(() => expect(screen.getByRole("searchbox")).toBeInTheDocument());
    expect(screen.queryByText("late")).not.toBeInTheDocument();
  });

  it("shows an error message when the README cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderMarket();
    fireEvent.click(screen.getByText("Dictionary"));
    expect(await screen.findByText("Could not load the plugin details.")).toBeInTheDocument();
  });
});
