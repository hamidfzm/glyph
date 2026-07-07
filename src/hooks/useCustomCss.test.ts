import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomCss } from "./useCustomCss";

const CSS_PATH = "/config/custom.css";
const styleEl = () => document.getElementById("glyph-custom-css");

function mockCommands(css: string | null) {
  vi.mocked(invoke).mockImplementation((cmd) => {
    if (cmd === "ensure_custom_css") return Promise.resolve(CSS_PATH);
    if (cmd === "read_custom_css") return Promise.resolve(css);
    return Promise.resolve(undefined); // watch_file / unwatch_file
  });
}

/** The file-changed handler the hook registered via subscribe(). */
function fileChangedHandler() {
  const call = vi.mocked(listen).mock.calls.find(([event]) => event === "file-changed");
  return call?.[1] as ((e: { payload: string }) => void) | undefined;
}

describe("useCustomCss", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockClear();
  });
  afterEach(() => {
    styleEl()?.remove();
  });

  it("ensures, injects, and watches the stylesheet when enabled", async () => {
    mockCommands(".markdown-body { color: red }");
    renderHook(() => useCustomCss(true, true));

    await waitFor(() => expect(styleEl()?.textContent).toContain("color: red"));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("ensure_custom_css");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("watch_file", { path: CSS_PATH });
  });

  it("re-reads and applies when the watched file changes", async () => {
    mockCommands("a { color: blue }");
    renderHook(() => useCustomCss(true, true));
    await waitFor(() => expect(styleEl()?.textContent).toContain("blue"));

    mockCommands("a { color: green }");
    fileChangedHandler()?.({ payload: CSS_PATH });
    await waitFor(() => expect(styleEl()?.textContent).toContain("green"));
  });

  it("ignores change events for other files", async () => {
    mockCommands("a { color: blue }");
    renderHook(() => useCustomCss(true, true));
    await waitFor(() => expect(styleEl()?.textContent).toContain("blue"));

    mockCommands("a { color: green }");
    fileChangedHandler()?.({ payload: "/somewhere/else.md" });
    // Give any wrongly-triggered re-read a tick to land.
    await new Promise((r) => setTimeout(r, 20));
    expect(styleEl()?.textContent).toContain("blue");
  });

  it("removes the stylesheet and the watch when disabled", async () => {
    mockCommands("a { color: blue }");
    const { rerender } = renderHook(({ on }) => useCustomCss(on, true), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(styleEl()).toBeTruthy());

    rerender({ on: false });
    expect(styleEl()).toBeNull();
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("unwatch_file", { path: CSS_PATH }),
    );
  });

  it("does nothing before settings have loaded", () => {
    renderHook(() => useCustomCss(true, false));
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("removes the element when the file has no content", async () => {
    mockCommands(null);
    const el = document.createElement("style");
    el.id = "glyph-custom-css";
    document.head.appendChild(el);

    renderHook(() => useCustomCss(true, true));
    await waitFor(() => expect(styleEl()).toBeNull());
  });

  it("logs instead of throwing when setup fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("io"));
    renderHook(() => useCustomCss(true, true));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });
});
