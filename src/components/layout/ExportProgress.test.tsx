import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExportProgress } from "./ExportProgress";

describe("ExportProgress", () => {
  it("shows a human-readable label per format", () => {
    const { rerender } = render(<ExportProgress format="html" />);
    expect(screen.getByRole("status")).toHaveTextContent("Exporting HTML…");

    rerender(<ExportProgress format="docx" />);
    expect(screen.getByRole("status")).toHaveTextContent("Exporting Word document…");

    rerender(<ExportProgress format="epub" />);
    expect(screen.getByRole("status")).toHaveTextContent("Exporting EPUB…");
  });

  it("is marked so the exporter never captures it in the output", () => {
    render(<ExportProgress format="html" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-export-ignore", "true");
  });

  it("shows determinate page counts for the website export", () => {
    render(<ExportProgress format="website" progress={{ done: 3, total: 7 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Exporting page 3 of 7…");
  });

  it("falls back to the format label while the page total is unknown", () => {
    render(<ExportProgress format="website" progress={{ done: 0, total: 0 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Exporting website…");
  });
});
