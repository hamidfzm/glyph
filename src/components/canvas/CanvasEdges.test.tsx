import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasEdge, CanvasNode, TextNode } from "@/lib/canvas/types";
import { CanvasEdges } from "./CanvasEdges";

const textNode = (over: Partial<TextNode> & { id: string }): TextNode => ({
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  text: "",
  ...over,
});

const nodes: CanvasNode[] = [
  textNode({ id: "a", x: 0, y: 0 }),
  textNode({ id: "b", x: 300, y: 200 }),
];

const edge = (over: Partial<CanvasEdge> & { id: string }): CanvasEdge => ({
  fromNode: "a",
  toNode: "b",
  ...over,
});

describe("CanvasEdges", () => {
  it("renders a path for each edge between two existing nodes", () => {
    const { container } = render(
      <CanvasEdges nodes={nodes} edges={[edge({ id: "e1" }), edge({ id: "e2" })]} />,
    );
    // Two edges, one drawn path each (no hit path in read-only mode).
    expect(container.querySelectorAll("path")).toHaveLength(2);
    expect(container.querySelector("title")?.textContent).toBe("Canvas connections");
  });

  it("skips an edge whose fromNode or toNode does not exist", () => {
    const { container } = render(
      <CanvasEdges
        nodes={nodes}
        edges={[
          edge({ id: "missing-from", fromNode: "ghost" }),
          edge({ id: "missing-to", toNode: "ghost" }),
          edge({ id: "ok" }),
        ]}
      />,
    );
    // Only the valid edge renders a path.
    expect(container.querySelectorAll("path")).toHaveLength(1);
  });

  it("renders an SVG text element for an edge label", () => {
    const { container, getByText } = render(
      <CanvasEdges nodes={nodes} edges={[edge({ id: "e1", label: "depends on" })]} />,
    );
    expect(getByText("depends on")).toBeInTheDocument();
    expect(container.querySelector("text.glyph-canvas-edge-label")?.textContent).toBe("depends on");
  });

  it("does not render a text element when there is no label", () => {
    const { container } = render(<CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} />);
    expect(container.querySelector("text")).toBeNull();
  });

  it("defaults toEnd to arrow and fromEnd to none (one polygon)", () => {
    const { container } = render(<CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} />);
    expect(container.querySelectorAll("polygon")).toHaveLength(1);
  });

  it("renders an extra polygon when fromEnd is arrow", () => {
    const { container } = render(
      <CanvasEdges nodes={nodes} edges={[edge({ id: "e1", fromEnd: "arrow" })]} />,
    );
    // to-arrow (default) + from-arrow = 2 polygons.
    expect(container.querySelectorAll("polygon")).toHaveLength(2);
  });

  it("removes the to-arrow when toEnd is none", () => {
    const { container } = render(
      <CanvasEdges nodes={nodes} edges={[edge({ id: "e1", toEnd: "none" })]} />,
    );
    expect(container.querySelectorAll("polygon")).toHaveLength(0);
  });

  it("renders both arrows off when both ends are none", () => {
    const { container } = render(
      <CanvasEdges nodes={nodes} edges={[edge({ id: "e1", toEnd: "none", fromEnd: "none" })]} />,
    );
    expect(container.querySelectorAll("polygon")).toHaveLength(0);
  });

  it("renders with inferred sides when fromSide/toSide are omitted", () => {
    const { container } = render(<CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} />);
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).toMatch(/^M /);
  });

  it("renders with explicit fromSide/toSide overriding inference", () => {
    const { container } = render(
      <CanvasEdges nodes={nodes} edges={[edge({ id: "e1", fromSide: "top", toSide: "left" })]} />,
    );
    expect(container.querySelectorAll("path")).toHaveLength(1);
  });

  it("uses the edge color when provided", () => {
    const { container } = render(
      <CanvasEdges nodes={nodes} edges={[edge({ id: "e1", color: "#ff0000" })]} />,
    );
    const group = container.querySelector("g");
    expect(group?.getAttribute("stroke")).toBe("#ff0000");
  });

  describe("interactive mode", () => {
    it("renders a transparent hit path and sets data-interactive when onSelectEdge is given", () => {
      const { container } = render(
        <CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} onSelectEdge={vi.fn()} />,
      );
      const svg = container.querySelector("svg.glyph-canvas-edges");
      expect(svg?.getAttribute("data-interactive")).toBe("true");
      expect(container.querySelector("path.glyph-canvas-edge-hit")).not.toBeNull();
      // hit path + drawn path.
      expect(container.querySelectorAll("path")).toHaveLength(2);
    });

    it("does not set data-interactive in read-only mode", () => {
      const { container } = render(<CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} />);
      const svg = container.querySelector("svg.glyph-canvas-edges");
      expect(svg?.hasAttribute("data-interactive")).toBe(false);
      expect(container.querySelector("path.glyph-canvas-edge-hit")).toBeNull();
    });

    it("calls onSelectEdge with the edge id on pointerdown of the hit path", () => {
      const onSelectEdge = vi.fn();
      const { container } = render(
        <CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} onSelectEdge={onSelectEdge} />,
      );
      const hit = container.querySelector("path.glyph-canvas-edge-hit");
      expect(hit).not.toBeNull();
      fireEvent.pointerDown(hit as Element);
      expect(onSelectEdge).toHaveBeenCalledTimes(1);
      expect(onSelectEdge).toHaveBeenCalledWith("e1", expect.anything());
    });
  });

  describe("selection", () => {
    it("highlights the selected edge with a thicker stroke", () => {
      const { container } = render(
        <CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} selectedId="e1" />,
      );
      // The drawn (non-hit) path is the last path in read-only mode.
      const drawn = container.querySelector("path:not(.glyph-canvas-edge-hit)");
      expect(drawn?.getAttribute("stroke-width")).toBe("3");
      const group = container.querySelector("g");
      expect(group?.getAttribute("stroke")).toBe("var(--color-accent)");
    });

    it("uses the default stroke width when an edge is not selected", () => {
      const { container } = render(
        <CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} selectedId="other" />,
      );
      const drawn = container.querySelector("path:not(.glyph-canvas-edge-hit)");
      expect(drawn?.getAttribute("stroke-width")).toBe("2");
    });

    it("renders without error when selectedId is null", () => {
      const { container } = render(
        <CanvasEdges nodes={nodes} edges={[edge({ id: "e1" })]} selectedId={null} />,
      );
      expect(container.querySelectorAll("path")).toHaveLength(1);
    });
  });
});
