import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusReport, WorkspaceSyncConfig } from "@/lib/sync";
import { relativeTime, summarise, SyncStatusIndicator } from "./SyncStatusIndicator";

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

function status(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    kind: "git",
    clean: true,
    ahead: 0,
    behind: 0,
    conflicts: [],
    lastSyncUnix: null,
    ...overrides,
  };
}

describe("summarise", () => {
  it("returns 'Sync off' for an unconfigured workspace", () => {
    expect(summarise(null, null)).toEqual({ label: "Sync off", tone: "off" });
  });

  it("returns 'Sync configured' when status hasn't been fetched yet", () => {
    expect(summarise(cfg(), null)).toEqual({ label: "Sync configured", tone: "ok" });
  });

  it("reports conflict count when the status has unresolved conflicts", () => {
    const out = summarise(cfg(), status({ conflicts: ["a.md", "b.md"] }));
    expect(out).toEqual({ label: "Conflicts (2)", tone: "error" });
  });

  it("reports ahead/behind counters when either is non-zero", () => {
    expect(summarise(cfg(), status({ ahead: 2, behind: 1 }))).toEqual({
      label: "Sync +2/-1",
      tone: "warn",
    });
    expect(summarise(cfg(), status({ ahead: 1, behind: 0 }))).toEqual({
      label: "Sync +1/-0",
      tone: "warn",
    });
    expect(summarise(cfg(), status({ ahead: 0, behind: 1 }))).toEqual({
      label: "Sync +0/-1",
      tone: "warn",
    });
  });

  it("reports 'Sync: dirty' when the working tree isn't clean", () => {
    expect(summarise(cfg(), status({ clean: false }))).toEqual({
      label: "Sync: dirty",
      tone: "warn",
    });
  });

  it("reports relative time when clean and lastSyncUnix is set", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:30Z"));
    try {
      const lastSyncUnix = Math.floor(new Date("2025-01-01T00:00:00Z").getTime() / 1000);
      expect(summarise(cfg(), status({ clean: true, lastSyncUnix }))).toEqual({
        label: "Synced 30s ago",
        tone: "ok",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports 'Synced' (no relative time) when lastSyncUnix is null", () => {
    expect(summarise(cfg(), status({ clean: true, lastSyncUnix: null }))).toEqual({
      label: "Synced",
      tone: "ok",
    });
  });
});

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats sub-minute deltas in seconds", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(relativeTime(now - 5)).toBe("5s ago");
    expect(relativeTime(now)).toBe("0s ago");
  });

  it("formats sub-hour deltas in minutes", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(relativeTime(now - 120)).toBe("2m ago");
    expect(relativeTime(now - 3599)).toBe("59m ago");
  });

  it("formats sub-day deltas in hours", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(relativeTime(now - 3600)).toBe("1h ago");
    expect(relativeTime(now - 86399)).toBe("23h ago");
  });

  it("formats day-and-up deltas in days", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(relativeTime(now - 86400)).toBe("1d ago");
    expect(relativeTime(now - 86400 * 7)).toBe("7d ago");
  });

  it("clamps future timestamps to zero seconds", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(relativeTime(now + 100)).toBe("0s ago");
  });
});
