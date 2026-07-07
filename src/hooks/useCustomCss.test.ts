import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomCss } from "./useCustomCss";

const styleEl = () => document.getElementById("glyph-custom-css");

describe("useCustomCss", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });
  afterEach(() => {
    styleEl()?.remove();
  });

  it("injects the stylesheet when enabled and the file exists", async () => {
    vi.mocked(invoke).mockResolvedValue(".markdown-body { color: red }");
    renderHook(() => useCustomCss(true, true));
    await waitFor(() => expect(styleEl()?.textContent).toContain("color: red"));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("read_custom_css");
  });

  it("removes the stylesheet when disabled", async () => {
    vi.mocked(invoke).mockResolvedValue("a { color: blue }");
    const { rerender } = renderHook(({ on }) => useCustomCss(on, true), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(styleEl()).toBeTruthy());

    rerender({ on: false });
    expect(styleEl()).toBeNull();
  });

  it("does nothing before settings have loaded", () => {
    renderHook(() => useCustomCss(true, false));
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("removes the element when the file does not exist", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const el = document.createElement("style");
    el.id = "glyph-custom-css";
    document.head.appendChild(el);

    renderHook(() => useCustomCss(true, true));
    await waitFor(() => expect(styleEl()).toBeNull());
  });

  it("logs instead of throwing when the read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("io"));
    renderHook(() => useCustomCss(true, true));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });
});
