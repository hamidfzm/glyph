import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownImage } from "@/components/markdown/MarkdownImage";
import { useLightbox } from "./LightboxContext";
import { LightboxProvider } from "./LightboxProvider";

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

  it("navigates between the document's images, updating the index", () => {
    renderDoc();
    fireEvent.click(screen.getByAltText("first"));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("falls back to the whole document when no image sits in a markdown-body", () => {
    render(
      <LightboxProvider>
        <MarkdownImage filePath={undefined} src="https://example.com/loose.png" alt="loose" />
      </LightboxProvider>,
    );
    fireEvent.click(screen.getByAltText("loose"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does nothing when opening an image that isn't in the document", () => {
    function Probe() {
      const lightbox = useLightbox();
      return (
        <button type="button" onClick={() => lightbox?.open(document.createElement("img"))}>
          probe
        </button>
      );
    }
    render(
      <LightboxProvider>
        <Probe />
      </LightboxProvider>,
    );
    fireEvent.click(screen.getByText("probe"));
    // A detached image isn't found in the scope, so no lightbox opens.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
