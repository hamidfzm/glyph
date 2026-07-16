import { platform } from "@tauri-apps/plugin-os";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "@/hooks/usePlatform";
import type { PlatformSelector } from "@/lib/platform";
import { ShowOn } from "./ShowOn";

function renderOn(detected: Platform, on: PlatformSelector | PlatformSelector[]) {
  vi.mocked(platform).mockReturnValue(detected as ReturnType<typeof platform>);
  return render(
    <ShowOn on={on}>
      <span>gated</span>
    </ShowOn>,
  );
}

afterEach(() => {
  vi.mocked(platform).mockReturnValue("macos");
});

describe("ShowOn", () => {
  it("renders children when a group selector matches", () => {
    renderOn("macos", "desktop");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("hides children when a group selector doesn't match", () => {
    for (const detected of ["android", "ios"] as const) {
      const { unmount } = renderOn(detected, "desktop");
      expect(screen.queryByText("gated")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("matches the mobile group", () => {
    renderOn("android", "mobile");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("matches a specific platform", () => {
    renderOn("macos", "macos");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("hides on a non-matching specific platform", () => {
    renderOn("windows", "macos");
    expect(screen.queryByText("gated")).not.toBeInTheDocument();
  });

  it("matches any selector in a list", () => {
    renderOn("linux", ["macos", "linux"]);
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("treats unknown as desktop for group selectors", () => {
    renderOn("unknown", "desktop");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });
});
