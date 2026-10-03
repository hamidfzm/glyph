import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { overlays, showOverlay } from "@/lib/plugins/overlays";
import type { OverlayContribution } from "@/lib/plugins/types";
import { PluginOverlay } from "./PluginOverlay";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: () => Promise.resolve(false) }),
}));

function open(overlay: Partial<OverlayContribution> = {}) {
  const entry = { id: "show", label: "Slide show", mount: vi.fn(), ...overlay };
  let remove = () => {};
  const close = vi.fn(() => remove());
  act(() => {
    remove = showOverlay({ ...entry, close });
  });
  return { close };
}

describe("PluginOverlay", () => {
  afterEach(() => {
    act(() => {
      for (const entry of overlays.list()) entry.close();
    });
    invoke.mockClear();
  });

  it("renders nothing while no overlay is open", () => {
    render(<PluginOverlay />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mounts the open overlay in a labeled fullscreen dialog", async () => {
    render(<PluginOverlay />);
    open({
      mount: (el) => {
        el.textContent = "Slide 1";
      },
    });

    const dialog = await screen.findByRole("dialog", { name: "Slide show" });
    expect(dialog).toHaveTextContent("Slide 1");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_overlay_fullscreen", { enter: true }),
    );
  });

  it("closes on Escape before the plugin's own handlers see it, and runs its cleanup", async () => {
    const cleanup = vi.fn();
    const pluginKeys = vi.fn();
    document.addEventListener("keydown", pluginKeys);
    render(<PluginOverlay />);
    const { close } = open({ mount: (_el, registerCleanup) => registerCleanup(cleanup) });
    await screen.findByRole("dialog");

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    document.removeEventListener("keydown", pluginKeys);

    expect(close).toHaveBeenCalled();
    expect(pluginKeys).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(cleanup).toHaveBeenCalled();
  });

  it("leaves other keys to the plugin", async () => {
    render(<PluginOverlay />);
    const { close } = open();
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(close).not.toHaveBeenCalled();
  });

  it("swaps in a newly opened overlay in place of the open one", async () => {
    render(<PluginOverlay />);
    const first = open({ label: "First" });
    await screen.findByRole("dialog", { name: "First" });

    open({ id: "second", label: "Second" });

    expect(first.close).toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Second" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("takes focus while open and hands it back on close", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    render(<PluginOverlay />);
    const { close } = open();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveFocus();

    act(() => close());
    await waitFor(() => expect(button).toHaveFocus());
    button.remove();
  });
});
