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
});
