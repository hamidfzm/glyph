import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import type { RegistryEntry } from "@/lib/plugins/marketplace";
import { createRegistry } from "@/lib/plugins/registry";
import type {
  CommandContribution,
  FencedRendererContribution,
  InstalledPlugin,
  MarkdownPlugin,
  StatusBarItemContribution,
} from "@/lib/plugins/types";
import { PluginsModal } from "./PluginsModal";

const installed: InstalledPlugin = {
  id: "a.b",
  name: "Alpha",
  version: "1.0.0",
  apiVersion: "^1.0.0",
  description: "the alpha plugin",
  dir: "/p/a.b",
  mainSource: "export default {};",
};

const available: RegistryEntry = {
  id: "c.d",
  name: "Charlie",
  description: "from the market",
  version: "2.0.0",
  apiVersion: "^1.0.0",
  mainUrl: "https://example.test/c.js",
};

function ctx(over: Partial<PluginsContextValue> = {}): PluginsContextValue {
  return {
    commands: createRegistry<CommandContribution>(),
    statusBarItems: createRegistry<StatusBarItemContribution>(),
    remarkPlugins: createRegistry<MarkdownPlugin>(),
    rehypePlugins: createRegistry<MarkdownPlugin>(),
    fencedRenderers: createRegistry<FencedRendererContribution>(),
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
  it("lists installed and available plugins", () => {
    renderModal(ctx());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("the alpha plugin")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
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

  it("installs from a folder and closes on Escape", () => {
    const value = ctx();
    const onClose = vi.fn();
    renderModal(value, onClose);
    fireEvent.click(screen.getByRole("button", { name: "Install from folder…" }));
    expect(value.installFromFolder).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows empty states", () => {
    renderModal(ctx({ installed: [], registry: [] }));
    expect(screen.getByText("No plugins installed.")).toBeInTheDocument();
    expect(screen.getByText("No plugins available.")).toBeInTheDocument();
  });
});
