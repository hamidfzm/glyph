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

  it("zooms with the keyboard", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "+" });
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
