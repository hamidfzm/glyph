import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { PLUGIN_API_VERSION } from "@/lib/plugins/apiVersion";
import type { RegistryEntry } from "@/lib/plugins/marketplace";
import { createRegistry } from "@/lib/plugins/registry";
import type {
  CommandContribution,
  ExporterContribution,
  FencedRendererContribution,
  InstalledPlugin,
  MarkdownPlugin,
  SettingsPanelContribution,
  SidebarPanelContribution,
  StatusBarItemContribution,
  StyleContribution,
} from "@/lib/plugins/types";
import { PluginsModal } from "./PluginsModal";

const installed: InstalledPlugin = {
  id: "a.b",
  name: "Alpha",
  version: "1.0.0",
  apiVersion: `^${PLUGIN_API_VERSION}`,
  description: "the alpha plugin",
  dir: "/p/a.b",
  mainSource: "export default {};",
};

const available: RegistryEntry = {
  id: "c.d",
  name: "Charlie",
  description: "from the market",
  version: "2.0.0",
  apiVersion: `^${PLUGIN_API_VERSION}`,
  mainUrl: "https://example.test/c.js",
};

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
    installed: [installed],
    disabled: [],
    loaded: [],
    registry: [available],
    updates: [],
    installFromFolder: vi.fn(async () => {}),
    installFromRegistry: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    setWorkspaceRoot: vi.fn(),
    ...over,
  };
}

function renderModal(value: PluginsContextValue, onClose = vi.fn()) {
  return render(
    <PluginsContext.Provider value={value}>
      <PluginsModal onClose={onClose} />
    </PluginsContext.Provider>,
  );
}

describe("PluginsModal", () => {
  it("renders nothing without a PluginsProvider", () => {
    const { container } = render(<PluginsModal onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists installed and available plugins", () => {
    renderModal(ctx());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("the alpha plugin")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("mounts a plugin's settings panel under its row, only while enabled", () => {
    const settingsPanels = createRegistry<SettingsPanelContribution>();
    settingsPanels.register({
      id: "a.b.settings",
      pluginId: "a.b",
      mount: (el) => {
        el.textContent = "size: 12";
      },
    });

    const { rerender } = renderModal(ctx({ settingsPanels }));
    expect(screen.getByText("size: 12")).toBeInTheDocument();

    // Disabled plugin: the panel disappears.
    rerender(
      <PluginsContext.Provider value={ctx({ settingsPanels, disabled: ["a.b"] })}>
        <PluginsModal onClose={vi.fn()} />
      </PluginsContext.Provider>,
    );
    expect(screen.queryByText("size: 12")).not.toBeInTheDocument();
  });

  it("shows an installed plugin's declared permissions", () => {
    renderModal(
      ctx({ installed: [{ ...installed, permissions: ["workspace:read", "network:api.test"] }] }),
    );
    expect(
      screen.getByText(
        (_, el) => el?.textContent === "Permissions: workspace:read, network:api.test",
      ),
    ).toBeInTheDocument();
  });

  it("shows an explicit None for plugins without permissions, on both lists", () => {
    renderModal(ctx());
    // One installed (Alpha, no permissions) and one marketplace entry (Charlie, none declared).
    expect(screen.getAllByText((_, el) => el?.textContent === "Permissions: None")).toHaveLength(2);
  });

  it("shows a marketplace entry's permissions and sandbox badge before install", () => {
    renderModal(
      ctx({
        registry: [{ ...available, permissions: ["network:api.example.com"], sandbox: true }],
      }),
    );
    expect(
      screen.getByText(
        (_, el) => el?.textContent === "Permissions: network:api.example.com · Sandboxed",
      ),
    ).toBeInTheDocument();
  });

  it("marks sandboxed installed plugins", () => {
    renderModal(ctx({ installed: [{ ...installed, sandbox: true }] }));
    expect(
      screen.getByText((_, el) => el?.textContent === "Permissions: None · Sandboxed"),
    ).toBeInTheDocument();
  });

  it("toggles an installed plugin's active state", () => {
    const value = ctx();
    renderModal(value);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(value.setEnabled).toHaveBeenCalledWith("a.b", false);
  });

  it("removes an installed plugin", () => {
    const value = ctx();
    renderModal(value);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(value.uninstall).toHaveBeenCalledWith("a.b");
  });

  it("installs an available plugin", () => {
    const value = ctx();
    renderModal(value);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(value.installFromRegistry).toHaveBeenCalledWith(available);
  });

  it("offers an update when one is available", () => {
    const value = ctx({
      updates: [{ entry: { ...available, id: "a.b" }, installedVersion: "1.0.0" }],
    });
    renderModal(value);
    fireEvent.click(screen.getByRole("button", { name: /Update to v2.0.0/ }));
    expect(value.installFromRegistry).toHaveBeenCalled();
  });

  it("installs from a folder and closes on Escape but not on other keys or inner clicks", () => {
    const value = ctx();
    const onClose = vi.fn();
    renderModal(value, onClose);
    fireEvent.click(screen.getByRole("button", { name: "Install from folder…" }));
    expect(value.installFromFolder).toHaveBeenCalled();

    // Neither a non-Escape key nor a click inside the panel closes the modal.
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.click(screen.getByText("Alpha"));
    expect(onClose).not.toHaveBeenCalled();

    // Clicking the backdrop itself closes.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows empty states", () => {
    renderModal(ctx({ installed: [], registry: [] }));
    expect(screen.getByText("No plugins installed.")).toBeInTheDocument();
    expect(screen.getByText("No plugins available.")).toBeInTheDocument();
  });
});
