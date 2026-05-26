import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import { SyncStatusIndicator } from "./SyncStatusIndicator";

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

function cfg(overrides: Partial<WorkspaceSyncConfig> = {}): WorkspaceSyncConfig {
  return {
    workspacePath: "/w",
    backend: "git",
    remoteUrl: "https://example.com/r.git",
    remoteBranch: "main",
    conflictPolicy: "prompt",
    autoSyncSeconds: null,
    author: null,
    ...overrides,
  };
}

describe("SyncStatusIndicator", () => {
  it("renders nothing when there is no workspace path", () => {
    const { container } = render(<SyncStatusIndicator workspacePath={null} onOpenSync={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Sync off' for an unconfigured workspace", async () => {
    routeInvoke({ sync_get_config: () => null });
    render(<SyncStatusIndicator workspacePath="/w" onOpenSync={vi.fn()} />);
    const btn = await screen.findByText("Sync off");
    expect(btn).toHaveAttribute("data-tone", "off");
  });

  it("shows 'Sync configured' when config is loaded but no status fetched yet", async () => {
    routeInvoke({ sync_get_config: () => cfg() });
    render(<SyncStatusIndicator workspacePath="/w" onOpenSync={vi.fn()} />);
    const btn = await screen.findByText("Sync configured");
    expect(btn).toHaveAttribute("data-tone", "ok");
  });

  it("clicking the indicator calls onOpenSync", async () => {
    routeInvoke({ sync_get_config: () => null });
    const onOpenSync = vi.fn();
    render(<SyncStatusIndicator workspacePath="/w" onOpenSync={onOpenSync} />);
    const btn = await screen.findByRole("button");
    fireEvent.click(btn);
    expect(onOpenSync).toHaveBeenCalledTimes(1);
  });
});
