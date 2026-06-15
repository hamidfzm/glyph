import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownImage } from "@/components/markdown/MarkdownImage";
import { LightboxProvider } from "./LightboxContext";

function renderDoc() {
  return render(
    <LightboxProvider>
      <div className="markdown-body">
        <MarkdownImage filePath={undefined} src="https://example.com/a.png" alt="first" />
        <MarkdownImage filePath={undefined} src="https://example.com/b.png" alt="second" />
      </div>
    </LightboxProvider>,
  );
}

describe("LightboxProvider", () => {
  it("marks images as zoomable and opens the lightbox on click", () => {
    renderDoc();
    const img = screen.getByAltText("first");
    expect(img).toHaveAttribute("data-zoomable", "true");

    fireEvent.click(img);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Opened at the clicked image, with the document's images for navigation.
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("opens at the index of the clicked image", () => {
    renderDoc();
    fireEvent.click(screen.getByAltText("second"));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("closes the lightbox so the overlay leaves the DOM", () => {
    renderDoc();
    fireEvent.click(screen.getByAltText("first"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
