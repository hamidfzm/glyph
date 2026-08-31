import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerSessionSidebarBridge,
  registerSessionZoomBridge,
  sessionSidebarBridge,
  sessionZoomBridge,
} from "./sessionUiBridge";

afterEach(() => {
  registerSessionZoomBridge(null);
  registerSessionSidebarBridge(null);
});

describe("sessionUiBridge", () => {
  it("defaults to null when nothing registered", () => {
    expect(sessionZoomBridge()).toBeNull();
    expect(sessionSidebarBridge()).toBeNull();
  });

  it("hands back the registered accessors and clears on unregister", () => {
    const zoom = { zoomByTabId: vi.fn(() => ({})), seedZoom: vi.fn() };
    const sidebar = {
      visibility: vi.fn(() => ({ filesSidebarVisible: true, outlineSidebarVisible: false })),
      applyVisibility: vi.fn(),
    };
    registerSessionZoomBridge(zoom);
    registerSessionSidebarBridge(sidebar);

    expect(sessionZoomBridge()).toBe(zoom);
    expect(sessionSidebarBridge()).toBe(sidebar);

    registerSessionZoomBridge(null);
    registerSessionSidebarBridge(null);
    expect(sessionZoomBridge()).toBeNull();
    expect(sessionSidebarBridge()).toBeNull();
  });
});
