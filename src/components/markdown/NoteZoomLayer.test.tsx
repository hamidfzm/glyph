import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useZoomApi } from "@/contexts/ZoomContext";
import { ZoomProvider } from "@/contexts/ZoomProvider";
import { NoteZoomLayer } from "./NoteZoomLayer";

// The wrapper is the outer flex div carrying the --glyph-font-size override.
function fontVar(container: HTMLElement): string {
  const wrapper = container.querySelector("div.flex.flex-col") as HTMLElement;
  return wrapper.style.getPropertyValue("--glyph-font-size");
}

function ZoomButton() {
  const api = useZoomApi();
  return (
    <button type="button" onClick={() => api?.actions.zoomIn()}>
      zoom-in
    </button>
  );
}

function renderLayer() {
  return render(
    <ZoomProvider>
      <NoteZoomLayer tabId="t1">
        <p>note body</p>
      </NoteZoomLayer>
      <ZoomButton />
    </ZoomProvider>,
  );
}

describe("NoteZoomLayer", () => {
  it("renders children under the saved font size at zoom 1", () => {
    const { container } = renderLayer();
    expect(screen.getByText("note body")).toBeInTheDocument();
    // Default settings font size is 16px, multiplier 1.
    expect(fontVar(container)).toBe("16px");
  });

  it("zooms with Ctrl + wheel and ignores a plain wheel", () => {
    const { container } = renderLayer();
    const wrapper = container.querySelector("div.flex.flex-col") as HTMLElement;
    // happy-dom's WheelEvent drops ctrlKey/deltaY from its init, so set them
    // directly on a dispatched event.
    const wheel = (ctrlKey: boolean, deltaY: number) =>
      act(() => {
        const event = new Event("wheel", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
        Object.defineProperty(event, "deltaY", { value: deltaY });
        wrapper.dispatchEvent(event);
      });

    wheel(false, -100);
    expect(fontVar(container)).toBe("16px");

    wheel(true, -100);
    expect(parseFloat(fontVar(container))).toBeGreaterThan(16);
  });

  it("responds to the registered Zoom In command", () => {
    const { container } = renderLayer();
    act(() => screen.getByText("zoom-in").click());
    expect(parseFloat(fontVar(container))).toBeCloseTo(16 * 1.1);
  });
});
