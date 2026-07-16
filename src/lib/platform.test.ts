import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMac, isMobile, isMobilePlatform, modKey } from "./platform";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "windows"),
}));

describe("isMac", () => {
  it("returns true for macos", () => {
    expect(isMac("macos")).toBe(true);
  });

  it("returns false for windows", () => {
    expect(isMac("windows")).toBe(false);
  });

  it("returns false for linux", () => {
    expect(isMac("linux")).toBe(false);
  });

  it("returns false for unknown", () => {
    expect(isMac("unknown")).toBe(false);
  });
});

describe("isMobile", () => {
  it("returns true for android", () => {
    expect(isMobile("android")).toBe(true);
  });

  it("returns true for ios", () => {
    expect(isMobile("ios")).toBe(true);
  });

  it("returns false for desktop platforms and unknown", () => {
    expect(isMobile("macos")).toBe(false);
    expect(isMobile("windows")).toBe(false);
    expect(isMobile("linux")).toBe(false);
    expect(isMobile("unknown")).toBe(false);
  });
});

describe("isMobilePlatform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when the OS plugin reports android", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("android");
    expect(isMobilePlatform()).toBe(true);
  });

  it("returns true when the OS plugin reports ios", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("ios");
    expect(isMobilePlatform()).toBe(true);
  });

  it("returns false on desktop", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("linux");
    expect(isMobilePlatform()).toBe(false);
  });

  it("falls back to desktop when the OS plugin throws", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockImplementation(() => {
      throw new Error("no tauri runtime");
    });
    expect(isMobilePlatform()).toBe(false);
  });
});

describe("modKey", () => {
  it("returns ⌘ for macos", () => {
    expect(modKey("macos")).toBe("⌘");
  });

  it("returns Ctrl for windows", () => {
    expect(modKey("windows")).toBe("Ctrl");
  });

  it("returns Ctrl for linux", () => {
    expect(modKey("linux")).toBe("Ctrl");
  });

  it("returns Ctrl for unknown", () => {
    expect(modKey("unknown")).toBe("Ctrl");
  });
});
