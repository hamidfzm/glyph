import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeMenuLabels } from "./useNativeMenuLabels";

const mockInvoke = vi.mocked(invoke);

describe("useNativeMenuLabels", () => {
  beforeEach(() => mockInvoke.mockClear());

  it("pushes the full localized menu label set to the backend on mount", async () => {
    renderHook(() => useNativeMenuLabels());
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        "set_menu_labels",
        expect.objectContaining({
          labels: expect.objectContaining({
            file: "File",
            open: "Open…",
            export: "Export",
            aiReadAloud: "Read Aloud",
          }),
        }),
      ),
    );
  });

  it("does nothing on mobile (no native menu there)", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("android");
    renderHook(() => useNativeMenuLabels());
    // Give the (absent) async push a chance to fire before asserting.
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
    vi.mocked(platform).mockReturnValue("macos");
  });
});
