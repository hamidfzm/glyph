import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlatform } from "./usePlatform";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "macos"),
}));

describe("usePlatform", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-platform");
  });

  it("detects macos platform", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("macos");

    const { result } = renderHook(() => usePlatform());
    await waitFor(() => {
      expect(result.current).toBe("macos");
    });
  });

  it("sets data-platform attribute on document", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("windows");

    renderHook(() => usePlatform());
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-platform")).toBe("windows");
    });
  });

  it("maps linux platform correctly", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("linux");

    const { result } = renderHook(() => usePlatform());
    await waitFor(() => {
      expect(result.current).toBe("linux");
    });
  });

  it("maps unknown platforms to unknown", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("freebsd" as ReturnType<typeof platform>);

    const { result } = renderHook(() => usePlatform());
    await waitFor(() => {
      expect(result.current).toBe("unknown");
    });
  });
});
