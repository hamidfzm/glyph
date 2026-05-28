import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidDiagram } from "./MermaidDiagram";

const initialize = vi.fn();
const renderMermaid = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => renderMermaid(...args),
  },
}));

describe("MermaidDiagram", () => {
  beforeEach(() => {
    initialize.mockReset();
    renderMermaid.mockReset();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("renders the diagram SVG into the container on mount", async () => {
    renderMermaid.mockResolvedValue({ svg: "<svg data-test='m'>x</svg>" });
    const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);

    await waitFor(() => {
      const svg = container.querySelector(".mermaid-diagram svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("data-test")).toBe("m");
    });
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "default", startOnLoad: false }),
    );
  });

  it("uses the dark theme when the document is in dark mode", async () => {
    renderMermaid.mockResolvedValue({ svg: "<svg/>" });
    document.documentElement.classList.add("dark");
    render(<MermaidDiagram code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
    });
  });

  it("shows the error fallback when render rejects", async () => {
    renderMermaid.mockRejectedValue(new Error("bad syntax"));
    const { container } = render(<MermaidDiagram code="garbage" />);

    await waitFor(() => {
      expect(container.querySelector(".mermaid-error")).not.toBeNull();
    });
    expect(container.querySelector(".mermaid-error-label")?.textContent).toContain(
      "Failed to render diagram",
    );
    expect(container.querySelector("pre code")?.textContent).toBe("garbage");
  });

  it("falls back to a generic error message when render rejects with a non-Error value", async () => {
    renderMermaid.mockRejectedValue("not an Error instance");
    const { container } = render(<MermaidDiagram code="garbage" />);

    await waitFor(() => {
      expect(container.querySelector(".mermaid-error")).not.toBeNull();
    });
    // We can't read the error string from the DOM (only "Failed to render
    // diagram" is rendered), but reaching the error UI at all proves the
    // non-Error branch in `setError(err instanceof Error ? ... : ...)` ran.
    expect(container.querySelector(".mermaid-error-label")?.textContent).toContain(
      "Failed to render diagram",
    );
  });

  it("flags empty/whitespace-only diagram source without calling mermaid.render", async () => {
    renderMermaid.mockResolvedValue({ svg: "<svg/>" });
    // JSX string-attribute values don't process backslash escapes, so wrap
    // in `{...}` to actually pass a tab+newline-bearing string.
    const { container } = render(<MermaidDiagram code={"   \n\t  "} />);

    await waitFor(() => {
      expect(container.querySelector(".mermaid-error")).not.toBeNull();
    });
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it("re-renders when the html class list changes (theme toggle)", async () => {
    renderMermaid.mockResolvedValue({ svg: "<svg/>" });
    render(<MermaidDiagram code="graph TD; A-->B" />);
    await waitFor(() => {
      expect(renderMermaid).toHaveBeenCalled();
    });
    const initialCalls = renderMermaid.mock.calls.length;

    document.documentElement.classList.add("dark");
    await waitFor(() => {
      expect(renderMermaid.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  // Regression: Mermaid v11 keeps internal state keyed by the id passed to
  // `render`. If we pass the same id twice (which happens whenever the
  // render callback fires more than once for the same component instance,
  // e.g. React 19 double-effect + the MutationObserver), the second call
  // returns a tiny stub SVG and the diagram silently blanks out. Pass a
  // fresh id every time.
  it("passes a fresh id to mermaid.render on every call", async () => {
    renderMermaid.mockResolvedValue({ svg: "<svg/>" });
    render(<MermaidDiagram code="graph TD; A-->B" />);
    document.documentElement.classList.add("dark");
    await waitFor(() => {
      expect(renderMermaid.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const ids = renderMermaid.mock.calls.map((c) => c[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Regression: when two renders are in flight concurrently, only the
  // newest one is allowed to write into the DOM. Otherwise a stale
  // (smaller, broken) SVG can overwrite a freshly-rendered good one.
  it("only the latest concurrent render writes its SVG to the DOM", async () => {
    // The first render hangs until we resolve it manually; the second
    // resolves immediately with a known SVG. The hung first call must
    // NOT overwrite the second's output once it eventually settles.
    type Resolver = (value: { svg: string }) => void;
    const firstRender: { resolve: Resolver } = { resolve: () => {} };
    renderMermaid.mockImplementationOnce(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          firstRender.resolve = resolve;
        }),
    );
    renderMermaid.mockResolvedValueOnce({ svg: "<svg id='winner'/>" });

    const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);
    // Trigger a second render via the theme MutationObserver path.
    document.documentElement.classList.add("dark");

    await waitFor(() => {
      expect(container.querySelector("svg#winner")).not.toBeNull();
    });

    // Now let the stale first render finally resolve — it must NOT
    // overwrite the winner.
    firstRender.resolve({ svg: "<svg id='stale'/>" });
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector("svg#stale")).toBeNull();
    expect(container.querySelector("svg#winner")).not.toBeNull();
  });
});
