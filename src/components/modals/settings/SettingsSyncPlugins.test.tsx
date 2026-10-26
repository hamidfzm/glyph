import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PluginReconcile } from "@/hooks/usePluginReconcile";
import type { Reconciliation } from "@/lib/pluginReconcile";
import type { RegistryEntry } from "@/lib/plugins/marketplace";
import { SettingsSyncPlugins } from "./SettingsSyncPlugins";

function entry(id: string, name: string): RegistryEntry {
  return {
    id,
    name,
    version: "2.1.0",
    apiVersion: "^0.27.0",
    packageUrl: `https://example.com/${id}.zip`,
    sha256: "0".repeat(64),
  };
}

const nothing: Reconciliation = {
  missing: [],
  manual: [],
  removals: [],
  toDisable: [],
  toEnable: [],
};

function reconcile(overrides: Partial<Reconciliation>, pendingId: string | null = null) {
  return {
    reconciliation: { ...nothing, ...overrides },
    pendingId,
    install: vi.fn(() => Promise.resolve()),
    installAll: vi.fn(() => Promise.resolve()),
    enable: vi.fn(() => Promise.resolve()),
  } satisfies PluginReconcile;
}

describe("SettingsSyncPlugins", () => {
  it("renders nothing when the synced setup asks nothing of this machine", () => {
    const { container } = render(<SettingsSyncPlugins reconcile={reconcile({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("installs one missing plugin or all of them", () => {
    const value = reconcile({ missing: [entry("a.a", "Alpha"), entry("b.b", "Beta")] });
    render(<SettingsSyncPlugins reconcile={value} />);
    expect(screen.getByText("Not installed on this machine")).toBeInTheDocument();
    expect(screen.getAllByText("Version 2.1.0")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Install Beta" }));
    expect(value.install).toHaveBeenCalledWith("b.b");
    fireEvent.click(screen.getByRole("button", { name: "Install all" }));
    expect(value.installAll).toHaveBeenCalled();
  });

  it("offers no Install all for a single plugin, and waits while one installs", () => {
    render(
      <SettingsSyncPlugins reconcile={reconcile({ missing: [entry("a.a", "Alpha")] }, "a.a")} />,
    );
    expect(screen.queryByRole("button", { name: "Install all" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Alpha" })).toBeDisabled();
  });

  it("turns on a plugin the synced setup has on", () => {
    const plugin = {
      id: "c.c",
      name: "Counter",
      version: "1.0.0",
      apiVersion: "^0.27.0",
      sandbox: true,
      dir: "/p",
      mainSource: "",
    };
    const value = reconcile({ toEnable: [plugin] });
    render(<SettingsSyncPlugins reconcile={value} />);
    expect(screen.getByText("Off on this machine")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn on Counter" }));
    expect(value.enable).toHaveBeenCalledWith("c.c");
  });

  it("says why a plugin has to be installed by hand", () => {
    const plugin = (id: string) => ({
      id,
      source: "local" as const,
      version: "1.0.0",
      enabled: true,
    });
    render(
      <SettingsSyncPlugins
        reconcile={reconcile({
          manual: [
            { plugin: plugin("l.l"), reason: "local" },
            { plugin: plugin("u.u"), reason: "unlisted" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Install these by hand")).toBeInTheDocument();
    expect(
      screen.getByText("Version 1.0.0, installed from a folder on another machine"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Version 1.0.0, no longer among the available plugins"),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
