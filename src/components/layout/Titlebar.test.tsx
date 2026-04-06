import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Titlebar } from "./Titlebar";

describe("Titlebar", () => {
  it("displays file name when provided", () => {
    render(<Titlebar fileName="README.md" />);
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("displays Glyph when no file name", () => {
    render(<Titlebar />);
    expect(screen.getByText("Glyph")).toBeInTheDocument();
  });

  it("displays Glyph for empty file name", () => {
    render(<Titlebar fileName="" />);
    expect(screen.getByText("Glyph")).toBeInTheDocument();
  });

  it("has drag region attribute", () => {
    const { container } = render(<Titlebar />);
    const dragRegion = container.querySelector("[data-tauri-drag-region]");
    expect(dragRegion).toBeTruthy();
  });
});
