import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import { nodesOf } from "@/test/fixtures/canvas";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: () => Promise.resolve(false) }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));

const tableCard = JSON.stringify({
  nodes: [
    {
      id: "t",
      type: "text",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      text: "| A | B |\n| --- | --- |\n| one | two |",
    },
  ],
  edges: [],
});

// React bubbles the lightbox's events to the card that rendered it, so each
// gesture a table invites (select text, double-click a word, right-click,
// Delete) must stay in the lightbox instead of editing the board behind it.
describe("CanvasEditor with a card's table in the lightbox", () => {
  it("keeps the lightbox's presses and keys off the board", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={tableCard} onChange={onChange} />);
    const expand = within(nodesOf(container)[0] as HTMLElement).getByRole("button", {
      name: "Expand table",
    });
    // Pressing the button selects the card, so Delete would remove it.
    fireEvent.pointerDown(expand, { button: 0 });
    fireEvent.pointerUp(expand, { button: 0 });
    fireEvent.click(expand);

    const dialog = screen.getByRole("dialog", { name: "Table viewer" });
    const cell = within(dialog).getByRole("cell", { name: "one" });
    fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(cell, { clientX: 200, clientY: 120 });
    fireEvent.pointerUp(cell, { clientX: 200, clientY: 120 });
    fireEvent.doubleClick(cell);
    fireEvent.contextMenu(cell);
    fireEvent.keyDown(cell, { key: "Delete" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Table viewer" })).toBeInTheDocument();
  });
});
