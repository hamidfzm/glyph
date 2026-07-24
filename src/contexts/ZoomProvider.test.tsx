import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNoteZoomMap, useZoomApi } from "./ZoomContext";
import { ZoomProvider } from "./ZoomProvider";

function Harness() {
  const api = useZoomApi();
  const map = useNoteZoomMap();
  if (!api || !map) return null;
  return (
    <div>
      <span data-testid="value">{map.a ?? "unset"}</span>
      <button type="button" onClick={() => api.setNoteZoom("a", (z) => z + 0.5)}>
        bump
      </button>
      <button
        type="button"
        onClick={() =>
          api.registerTarget({
            zoomIn: () => api.setNoteZoom("a", () => 99),
            zoomOut: () => {},
            zoomReset: () => {},
          })
        }
      >
        register
      </button>
      <button type="button" onClick={() => api.registerTarget(null)}>
        unregister
      </button>
      <button type="button" onClick={() => api.actions.zoomIn()}>
        dispatch
      </button>
    </div>
  );
}

function renderHarness() {
  return render(
    <ZoomProvider>
      <Harness />
    </ZoomProvider>,
  );
}

describe("ZoomProvider", () => {
  it("updates a note tab's multiplier through setNoteZoom", () => {
    renderHarness();
    expect(screen.getByTestId("value").textContent).toBe("unset");
    act(() => screen.getByText("bump").click());
    expect(screen.getByTestId("value").textContent).toBe("1.5");
  });

  it("dispatches zoom actions to the registered target", () => {
    renderHarness();
    act(() => screen.getByText("register").click());
    act(() => screen.getByText("dispatch").click());
    expect(screen.getByTestId("value").textContent).toBe("99");
  });

  it("no-ops when nothing is registered", () => {
    renderHarness();
    act(() => screen.getByText("register").click());
    act(() => screen.getByText("unregister").click());
    // Should not throw and should not change the value.
    act(() => screen.getByText("dispatch").click());
    expect(screen.getByTestId("value").textContent).toBe("unset");
  });
});
