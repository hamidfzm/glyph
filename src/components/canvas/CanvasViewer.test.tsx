import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasViewer } from "./CanvasViewer";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const canvas = (over: object) => JSON.stringify({ nodes: [], edges: [], ...over });

describe("CanvasViewer", () => {
  it("renders a text node's markdown", () => {
    const content = canvas({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "# Hello" }],
    });
    render(<CanvasViewer content={content} />);
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });

  it("renders a link node showing its url", () => {
    const content = canvas({
      nodes: [
        { id: "l", type: "link", x: 0, y: 0, width: 200, height: 80, url: "https://glyph.dev" },
      ],
    });
    render(<CanvasViewer content={content} />);
    expect(screen.getByText("https://glyph.dev")).toBeInTheDocument();
  });

  it("shows an error state for invalid canvas JSON", () => {
    render(<CanvasViewer content="{ not json" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders zoom controls", () => {
    render(<CanvasViewer content={canvas({})} />);
    expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    expect(screen.getByLabelText("Fit to content")).toBeInTheDocument();
  });
});
