import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatusIndicator } from "@/components/layout/SyncStatusIndicator";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import type { Workspace } from "@/lib/tabs";
import { tabsContextValue } from "@/test/fixtures/tabsContext";
import { useSyncConfigContext } from "./SyncConfigContext";
import { SyncConfigProvider } from "./SyncConfigProvider";
import { TabsContext } from "./TabsContext";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

function routeInvoke(handlers: Record<string, (args: unknown) => unknown>) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    const handler = handlers[cmd];
    if (!handler) return Promise.reject(new Error(`no handler for ${cmd}`));
    return Promise.resolve(handler(args) as never);
  });
}

function makeWorkspace(root = "/w"): Workspace {
  return { root, expanded: new Set(), nodes: new Map() };
}

function wrap(workspace: Workspace | null) {
  return ({ children }: { children: ReactNode }) => (
    <TabsContext.Provider value={tabsContextValue({ workspace })}>
      <SyncConfigProvider>{children}</SyncConfigProvider>
    </TabsContext.Provider>
  );
}

const localConfig: WorkspaceSyncConfig = {
  workspacePath: "/w",
  backend: "git",
  remoteUrl: "",
  remoteBranch: "main",
  conflictPolicy: "prompt",
  author: null,
};

// A tiny consumer that enables sync through the shared context, mimicking
// what the Cloud Sync modal does on "Save config".
function EnableButton() {
  const { save } = useSyncConfigContext();
  return (
    <button type="button" onClick={() => save(localConfig)}>
      enable
    </button>
  );
}

describe("SyncConfigContext", () => {
  it("the status pill reflects a config saved through the shared context", async () => {
    // Starts unconfigured: get_config returns null.
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => false,
      sync_set_config: () => null,
    });

    render(
      <>
        <SyncStatusIndicator onOpenSync={vi.fn()} />
        <EnableButton />
      </>,
      { wrapper: wrap(makeWorkspace()) },
    );

    // The pill starts on "Sync off" (no config loaded).
    expect(await screen.findByText("Sync off")).toBeInTheDocument();

    // Enabling through the shared context updates the same instance the
    // pill reads from, so it flips without a remount or manual refresh.
    fireEvent.click(screen.getByRole("button", { name: "enable" }));
    await waitFor(() => expect(screen.getByText("Sync configured")).toBeInTheDocument());
    expect(screen.queryByText("Sync off")).toBeNull();
  });

  it("exposes a null workspace path when no workspace is open", async () => {
    let seen: string | null | undefined;
    function Probe() {
      seen = useSyncConfigContext().workspacePath;
      return null;
    }
    render(<Probe />, { wrapper: wrap(null) });
    await waitFor(() => expect(seen).toBeNull());
    // No workspace => no sync commands fire on mount.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("throws when used outside the provider", () => {
    function Bare() {
      useSyncConfigContext();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/SyncConfigProvider/);
    spy.mockRestore();
  });
});
