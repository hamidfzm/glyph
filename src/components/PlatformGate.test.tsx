import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Platform } from "@/hooks/usePlatform";
import type { PlatformSelector } from "@/lib/platform";
import { PlatformGate } from "./PlatformGate";

function renderGate(platform: Platform, on: PlatformSelector | PlatformSelector[]) {
  return render(
    <PlatformGate platform={platform} on={on}>
      <span>gated</span>
    </PlatformGate>,
  );
}

describe("PlatformGate", () => {
  it("renders children when a group selector matches", () => {
    renderGate("macos", "desktop");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("hides children when a group selector doesn't match", () => {
    for (const platform of ["android", "ios"] as const) {
      const { unmount } = renderGate(platform, "desktop");
      expect(screen.queryByText("gated")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("matches the mobile group", () => {
    renderGate("android", "mobile");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("matches a specific platform", () => {
    renderGate("macos", "macos");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("hides on a non-matching specific platform", () => {
    renderGate("windows", "macos");
    expect(screen.queryByText("gated")).not.toBeInTheDocument();
  });

  it("matches any selector in a list", () => {
    renderGate("linux", ["macos", "linux"]);
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("treats unknown as desktop for group selectors", () => {
    renderGate("unknown", "desktop");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });
});
