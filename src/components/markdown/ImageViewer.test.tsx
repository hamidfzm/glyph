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

  it("lays out an image with intrinsic size and scales its width on zoom", () => {
    const { container } = render(<ImageViewer filePath="/a/photo.png" />);
    const img = container.querySelector("img.image-viewer-img") as HTMLImageElement;
    // Mock a real intrinsic size (happy-dom reports 0 otherwise) to hit the pixel path.
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
    fireEvent.load(img);

    // Intrinsic branch: explicit pixel width, no object-fit contain.
    const fitWidth = parseFloat(img.style.width);
    expect(fitWidth).toBeGreaterThan(0);
    expect(img.style.objectFit).toBe("");

    fireEvent.click(screen.getByLabelText("Zoom in (+)"));
    expect(parseFloat(img.style.width)).toBeCloseTo(fitWidth * 1.25);
  });

  it("contains a dimensionless SVG (no intrinsic pixel size) and zooms via transform", () => {
    const { container } = render(<ImageViewer filePath="/a/icon.svg" />);
    const img = container.querySelector("img.image-viewer-img") as HTMLImageElement;
    // happy-dom reports naturalWidth/Height === 0, like an SVG with only a viewBox.
    fireEvent.load(img);
    expect(img.style.objectFit).toBe("contain");
    expect(img.style.width).toBe("100%");
    expect(img.style.transform).toBe("scale(1)");
  });

  it("recomputes the fit on window resize while fitted", () => {
    const { container } = render(<ImageViewer filePath="/a/photo.png" />);
    const img = container.querySelector("img.image-viewer-img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
    fireEvent.load(img);
    fireEvent(window, new Event("resize"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("stops refitting on resize once the user has zoomed", () => {
    const { container } = render(<ImageViewer filePath="/a/photo.png" />);
    const img = container.querySelector("img.image-viewer-img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
    fireEvent.load(img);
    fireEvent.click(screen.getByLabelText("Zoom in (+)"));
    const widthAfterZoom = img.style.width;
    fireEvent(window, new Event("resize"));
    expect(img.style.width).toBe(widthAfterZoom);
  });
});
