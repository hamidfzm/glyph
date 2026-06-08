import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConfigContext, type SyncConfigContextValue } from "@/contexts/SyncConfigContext";
import type { StatusReport, WorkspaceSyncConfig } from "@/lib/sync";
import { relativeTime, SyncStatusIndicator, summarise } from "./SyncStatusIndicator";

function cfg(overrides: Partial<WorkspaceSyncConfig> = {}): WorkspaceSyncConfig {
  return {
    workspacePath: "/w",
    backend: "git",
    remoteUrl: "https://example.com/r.git",
    remoteBranch: "main",
    conflictPolicy: "prompt",
    author: null,
    ...overrides,
  };
}

/** Build a full context value; the indicator only reads config/status/path. */
function ctxValue(over: Partial<SyncConfigContextValue> = {}): SyncConfigContextValue {
  return {
    workspacePath: "/w",
    config: null,
    status: null,
    defaultAuthor: null,
    repoPresent: null,
    loading: false,
    busy: false,
    error: null,
    save: vi.fn(),
    remove: vi.fn(),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    initRepo: vi.fn(),
    cloneRemote: vi.fn(),
    setOrigin: vi.fn(),
    commitConfig: vi.fn(),
    runSync: vi.fn(),
    refreshStatus: vi.fn(),
    refreshRepoPresent: vi.fn(),
    ...over,
  };
}

function renderIndicator(over: Partial<SyncConfigContextValue>, onOpenSync = vi.fn()) {
  return render(
    <SyncConfigContext.Provider value={ctxValue(over)}>
      <SyncStatusIndicator onOpenSync={onOpenSync} />
    </SyncConfigContext.Provider>,
  );
}

describe("SyncStatusIndicator", () => {
  it("renders nothing when there is no workspace path", () => {
    const { container } = renderIndicator({ workspacePath: null });
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Sync off' for an unconfigured workspace", () => {
    renderIndicator({ workspacePath: "/w", config: null, status: null });
    expect(screen.getByText("Sync off")).toHaveAttribute("data-tone", "off");
  });

  it("shows 'Sync configured' when config is loaded but no status fetched yet", () => {
    renderIndicator({ config: cfg(), status: null });
    expect(screen.getByText("Sync configured")).toHaveAttribute("data-tone", "ok");
  });

  it("clicking the indicator calls onOpenSync", () => {
    const onOpenSync = vi.fn();
    renderIndicator({ config: cfg() }, onOpenSync);
    fireEvent.click(screen.getByRole("button"));
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
