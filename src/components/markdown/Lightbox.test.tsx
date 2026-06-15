import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "./Lightbox";

const IMAGES = [
  { src: "a.png", alt: "first" },
  { src: "b.png", alt: "second" },
  { src: "c.png", alt: "third" },
];

// Drives the controlled `index` so navigation can be asserted end to end.
function Harness({ onClose = () => {}, start = 0 }: { onClose?: () => void; start?: number }) {
  const [index, setIndex] = useState(start);
  return <Lightbox images={IMAGES} index={index} onIndexChange={setIndex} onClose={onClose} />;
}

describe("Lightbox", () => {
  it("renders the current image and a counter for multiple images", () => {
    render(<Harness />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByAltText("first")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("navigates with the arrow keys, clamping at the ends", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByAltText("second")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    // Already at the first image — left does nothing.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("navigates with the prev/next buttons and disables them at the ends", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Previous image (←)")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Next image (→)"));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous image (←)")).toBeEnabled();
  });

  it("adjusts the zoom level via the toolbar and resets with actual size", () => {
    render(<Harness />);
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Zoom in (+)"));
    expect(screen.getByText("125%")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Actual size (1)"));
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Zoom out (-)"));
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("shows an image with no intrinsic size (SVG) and zooms it via transform", () => {
    render(<Harness />);
    const img = screen.getByAltText("first") as HTMLImageElement;
    // jsdom reports naturalWidth/Height === 0, like an SVG with only a viewBox.
    fireEvent.load(img);

    // Visible and contained (not collapsed), and zoom scales it.
    expect(img.style.opacity).toBe("1");
    expect(img.style.objectFit).toBe("contain");
    expect(img.style.transform).toBe("scale(1)");

    fireEvent.keyDown(window, { key: "+" });
    expect(img.style.transform).toBe("scale(1.25)");
  });

  it("zooms with the keyboard", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "+" });
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("zooms in with the = key (no shift needed)", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "=" });
    expect(screen.getByText("125%")).toBeInTheDocument();
  });

  it("zooms out and refits with the keyboard", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "+" });
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "-" });
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "+" });
    fireEvent.keyDown(window, { key: "0" });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("closes on Escape dispatched from the dialog itself", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates back with the prev button when past the first image", () => {
    render(<Harness start={1} />);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Previous image (←)"));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("lays out an image with intrinsic pixel size and scales its width on zoom", () => {
    render(<Harness />);
    const img = screen.getByAltText("first") as HTMLImageElement;
    // Mock a real intrinsic size (jsdom reports 0 otherwise) to hit the pixel path.
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
    fireEvent.load(img);

    // Intrinsic branch: explicit pixel width, no object-fit contain.
    const fitWidth = parseFloat(img.style.width);
    expect(fitWidth).toBeGreaterThan(0);
    expect(img.style.objectFit).toBe("");

    fireEvent.keyDown(window, { key: "+" });
    expect(parseFloat(img.style.width)).toBeCloseTo(fitWidth * 1.25);
  });

  it("recomputes the fit on window resize while fitted", () => {
    render(<Harness />);
    const img = screen.getByAltText("first") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
    fireEvent.load(img);
    fireEvent(window, new Event("resize"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("ignores arrow keys and hides nav when there is a single image", () => {
    render(
      <Lightbox
        images={[{ src: "only.png", alt: "only" }]}
        index={0}
        onIndexChange={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Next image (→)")).not.toBeInTheDocument();
    // Arrow keys are no-ops with one image (the counter isn't shown either).
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByAltText("only")).toBeInTheDocument();
  });

  it("ignores non-Escape keys dispatched on the dialog", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders nothing when the index is out of range", () => {
    const { container } = render(
      <Lightbox images={IMAGES} index={99} onIndexChange={() => {}} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("uses a generic label when the image has no alt text", () => {
    render(
      <Lightbox
        images={[{ src: "a.png", alt: "" }]}
        index={0}
        onIndexChange={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Image viewer" })).toBeInTheDocument();
  });
});
