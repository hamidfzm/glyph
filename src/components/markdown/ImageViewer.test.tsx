import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageViewer } from "./ImageViewer";

describe("ImageViewer", () => {
  it("renders the image through the asset protocol", () => {
    const { container } = render(<ImageViewer filePath="/notes/diagram.svg" />);
    const img = container.querySelector("img.image-viewer-img");
    // convertFileSrc is mocked to asset://localhost/<path> in the test setup.
    expect(img?.getAttribute("src")).toBe("asset://localhost//notes/diagram.svg");
  });

  it("exposes an image-viewer region", () => {
    render(<ImageViewer filePath="/a/b/photo.png" />);
    expect(screen.getByRole("region", { name: "Image viewer" })).toBeInTheDocument();
  });

  it("zooms in and out from the toolbar", () => {
    render(<ImageViewer filePath="/a/b/photo.png" />);
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Zoom in (+)"));
    expect(screen.getByText("125%")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Zoom out (-)"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("resets to actual size", () => {
    render(<ImageViewer filePath="/a/b/photo.png" />);
    fireEvent.click(screen.getByLabelText("Zoom in (+)"));
    fireEvent.click(screen.getByLabelText("Actual size (1)"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
