import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasEditor, CanvasViewer } from "./lazyCanvas";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const board = JSON.stringify({
  nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "lazy node" }],
  edges: [],
});

// Thin Suspense wrappers that code-split the canvas renderer. The dynamic import
// resolves asynchronously, so each test waits for the real component to appear,
// exercising both the fallback and resolved paths.
// The first dynamic import can be slow when the full suite runs under machine
// load, so these tests get a longer timeout than the 5s default.
describe("lazyCanvas", () => {
  it("lazily renders the CanvasViewer", { timeout: 15000 }, async () => {
    render(<CanvasViewer content={board} />);
    await waitFor(() => expect(screen.getByText("lazy node")).toBeInTheDocument(), {
      timeout: 15000,
    });
  });

  it("lazily renders the CanvasEditor", { timeout: 15000 }, async () => {
    render(<CanvasEditor content={board} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("lazy node")).toBeInTheDocument(), {
      timeout: 15000,
    });
  });
});
