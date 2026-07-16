import { platform } from "@tauri-apps/plugin-os";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "@/hooks/usePlatform";
import { ShowOn } from "./ShowOn";

function renderOn(detected: Platform, on: "desktop" | "mobile") {
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
  it("shows desktop content on desktop", () => {
    renderOn("macos", "desktop");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("hides desktop content on mobile", () => {
    renderOn("android", "desktop");
    expect(screen.queryByText("gated")).not.toBeInTheDocument();
  });

  it("shows mobile content on mobile", () => {
    renderOn("ios", "mobile");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });

  it("treats unknown as desktop", () => {
    renderOn("unknown", "desktop");
    expect(screen.getByText("gated")).toBeInTheDocument();
  });
});
