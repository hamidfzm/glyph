import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { overlays, showOverlay } from "@/lib/plugins/overlays";
import type { OverlayContribution } from "@/lib/plugins/types";
import { expectConsole } from "@/test/consoleGuard";
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

  it("closes on Escape and runs the plugin's cleanup", async () => {
    const cleanup = vi.fn();
    render(<PluginOverlay />);
    const { close } = open({ mount: (_el, registerCleanup) => registerCleanup(cleanup) });
    await screen.findByRole("dialog");

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect(close).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(cleanup).toHaveBeenCalled();
  });

  it("sees Escape before any key handler the plugin adds while mounting", async () => {
    // Capture on window is the earliest a listener can sit; the host's must
    // already be there when mount() runs, or a plugin could swallow Escape.
    const swallow = vi.fn((e: KeyboardEvent) => e.stopImmediatePropagation());
    const bubbling = vi.fn();
    render(<PluginOverlay />);
    const { close } = open({
      mount: (_el, registerCleanup) => {
        window.addEventListener("keydown", swallow, true);
        document.addEventListener("keydown", bubbling);
        registerCleanup(() => {
          window.removeEventListener("keydown", swallow, true);
          document.removeEventListener("keydown", bubbling);
        });
      },
    });
    await screen.findByRole("dialog");

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(close).toHaveBeenCalled();
    expect(swallow).not.toHaveBeenCalled();
    expect(bubbling).not.toHaveBeenCalled();
  });

  it("sees Escape before a key handler a plugin added when it activated", async () => {
    render(<PluginOverlay />);
    // Long before any overlay opens: a listener the host adds on open would
    // sit behind this one and never hear the key.
    const swallow = vi.fn((e: KeyboardEvent) => e.stopImmediatePropagation());
    window.addEventListener("keydown", swallow, true);
    const { close } = open();
    await screen.findByRole("dialog");

    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", swallow, true);

    expect(close).toHaveBeenCalled();
    expect(swallow).not.toHaveBeenCalled();
  });

  it("leaves Escape alone while no overlay is open", () => {
    const appKeys = vi.fn();
    document.addEventListener("keydown", appKeys);
    render(<PluginOverlay />);

    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", appKeys);

    expect(appKeys).toHaveBeenCalledOnce();
  });

  it("leaves other keys to the plugin", async () => {
    render(<PluginOverlay />);
    const { close } = open();
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(close).not.toHaveBeenCalled();
  });

  it("closes from the host's own close button", async () => {
    render(<PluginOverlay />);
    const { close } = open();

    fireEvent.click(await screen.findByRole("button", { name: "Close (Esc)" }));

    expect(close).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes instead of leaving a blank fullscreen layer when mount throws", async () => {
    expectConsole(/threw in mount\(\)/);
    render(<PluginOverlay />);
    const { close } = open({
      mount: () => {
        throw new Error("boom");
      },
    });

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
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

  it("leaves focus where the plugin put it, and still restores the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    render(<PluginOverlay />);
    const { close } = open({
      mount: (el) => {
        const deck = document.createElement("div");
        deck.tabIndex = 0;
        deck.dataset.testid = "deck";
        el.append(deck);
        deck.focus();
      },
    });
    await screen.findByRole("dialog");
    expect(screen.getByTestId("deck")).toHaveFocus();

    act(() => close());
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });
});
