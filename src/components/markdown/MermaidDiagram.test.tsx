import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidDiagram } from "./MermaidDiagram";

// The component delegates rendering (and caching) to the mermaidRender lib;
// its own contract is what gets asked for and what happens with the result,
// so the lib is mocked here. Cache/id/theme-config behavior is covered in
// mermaidRender.test.ts.
const renderMermaid = vi.fn();

vi.mock("@/lib/mermaidRender", () => ({
  renderMermaid: (...args: unknown[]) => renderMermaid(...args),
}));

// Controllable lightbox: null by default (no provider in scope), set per-test to
// exercise the click-to-zoom path.
let mockLightbox: { open: ReturnType<typeof vi.fn>; openSrc: ReturnType<typeof vi.fn> } | null =
  null;
vi.mock("@/contexts/LightboxContext", () => ({
  useLightbox: () => mockLightbox,
}));

describe("MermaidDiagram", () => {
  beforeEach(() => {
    renderMermaid.mockReset();
    mockLightbox = null;
    document.documentElement.classList.remove("dark");
  });

  afterEach(async () => {
    // happy-dom writes the class attribute even when "dark" is absent, which
    // fires the useIsDarkMode MutationObserver while the component is still
    // mounted (RTL cleanup runs later), so the write must happen inside act.
    await act(async () => {
      document.documentElement.classList.remove("dark");
    });
  });

  it("renders the diagram SVG into the container on mount", async () => {
    renderMermaid.mockResolvedValue("<svg data-test='m'>x</svg>");
    const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);

    await waitFor(() => {
      const svg = container.querySelector(".mermaid-diagram svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("data-test")).toBe("m");
    });
    expect(renderMermaid).toHaveBeenCalledWith("graph TD; A-->B", false);
  });

  it("requests the dark theme when the document is in dark mode", async () => {
    renderMermaid.mockResolvedValue("<svg/>");
    document.documentElement.classList.add("dark");
    render(<MermaidDiagram code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(renderMermaid).toHaveBeenCalledWith("graph TD; A-->B", true);
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

  it("flags empty/whitespace-only diagram source without rendering", async () => {
    renderMermaid.mockResolvedValue("<svg/>");
    // JSX string-attribute values don't process backslash escapes, so wrap
    // in `{...}` to actually pass a tab+newline-bearing string.
    const { container } = render(<MermaidDiagram code={"   \n\t  "} />);

    await waitFor(() => {
      expect(container.querySelector(".mermaid-error")).not.toBeNull();
    });
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it("re-renders when the html class list changes (theme toggle)", async () => {
    renderMermaid.mockResolvedValue("<svg/>");
    render(<MermaidDiagram code="graph TD; A-->B" />);
    await waitFor(() => {
      expect(renderMermaid).toHaveBeenCalled();
    });
    const initialCalls = renderMermaid.mock.calls.length;

    await act(async () => {
      document.documentElement.classList.add("dark");
    });
    await waitFor(() => {
      expect(renderMermaid.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  // Regression: when two renders are in flight concurrently, only the
  // newest one is allowed to write into the DOM. Otherwise a stale
  // (smaller, broken) SVG can overwrite a freshly-rendered good one.
  it("only the latest concurrent render writes its SVG to the DOM", async () => {
    // The first render hangs until we resolve it manually; the second
    // resolves immediately with a known SVG. The hung first call must
    // NOT overwrite the second's output once it eventually settles.
    type Resolver = (svg: string) => void;
    const firstRender: { resolve: Resolver } = { resolve: () => {} };
    renderMermaid.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          firstRender.resolve = resolve;
        }),
    );
    renderMermaid.mockResolvedValueOnce("<svg id='winner'/>");

    const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);
    // Trigger a second render via the theme MutationObserver path.
    await act(async () => {
      document.documentElement.classList.add("dark");
    });

    await waitFor(() => {
      expect(container.querySelector("svg#winner")).not.toBeNull();
    });

    // Now let the stale first render finally resolve; it must NOT
    // overwrite the winner.
    firstRender.resolve("<svg id='stale'/>");
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector("svg#stale")).toBeNull();
    expect(container.querySelector("svg#winner")).not.toBeNull();
  });

  // Defensive nil-check: if the component unmounts while a render is in
  // flight, `containerRef.current` is null by the time the await resolves
  // and we must not try to write into it.
  it("skips the DOM write when the container ref is null at resolution time", async () => {
    type Resolver = (svg: string) => void;
    const pending: { resolve: Resolver } = { resolve: () => {} };
    renderMermaid.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          pending.resolve = resolve;
        }),
    );

    const { unmount } = render(<MermaidDiagram code="graph TD; A-->B" />);
    // Make sure renderDiagram actually reached the awaited render before we
    // tear down; otherwise unmount could happen before the function
    // captures the (then-still-non-null) ref into its closure.
    await waitFor(() => expect(renderMermaid).toHaveBeenCalled());
    unmount();
    // Now resolve. The awaited continuation runs as a microtask AFTER
    // unmount, so `containerRef.current` is null and the false branch of
    // the nil-check fires (skipping the DOM write).
    pending.resolve("<svg id='post-unmount'/>");
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector("svg#post-unmount")).toBeNull();
  });

  // Symmetry with the success-path guard: if a stale render REJECTS after
  // a newer render has already painted a good SVG, the stale rejection
  // must not flip the component into the error UI.
  it("does not flip into the error UI when a stale render rejects after a newer one wins", async () => {
    type Rejecter = (reason: unknown) => void;
    const firstRender: { reject: Rejecter } = { reject: () => {} };
    renderMermaid.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          firstRender.reject = reject;
        }),
    );
    renderMermaid.mockResolvedValueOnce("<svg id='winner'/>");

    const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);
    await act(async () => {
      document.documentElement.classList.add("dark");
    });

    await waitFor(() => {
      expect(container.querySelector("svg#winner")).not.toBeNull();
    });

    // The stale first render finally fails. The newer render has already
    // settled successfully, so the rejection must be dropped.
    firstRender.reject(new Error("stale failure"));
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector(".mermaid-error")).toBeNull();
    expect(container.querySelector("svg#winner")).not.toBeNull();
  });

  describe("lightbox zoom", () => {
    beforeEach(() => {
      mockLightbox = { open: vi.fn(), openSrc: vi.fn() };
    });

    it("is a zoomable button and opens the rendered SVG in the lightbox on click", async () => {
      renderMermaid.mockResolvedValue("<svg id='zoomed'/>");
      const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);

      const diagram = await waitFor(() => {
        const el = container.querySelector(".mermaid-diagram");
        expect(el?.getAttribute("role")).toBe("button");
        return el as HTMLElement;
      });
      fireEvent.click(diagram);

      expect(mockLightbox?.openSrc).toHaveBeenCalledTimes(1);
      expect(mockLightbox?.openSrc.mock.calls[0][0]).toMatch(/^data:image\/svg\+xml/);
    });

    it("opens the lightbox on Enter and Space but not other keys", async () => {
      renderMermaid.mockResolvedValue("<svg/>");
      const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);
      const diagram = await waitFor(
        () => container.querySelector(".mermaid-diagram") as HTMLElement,
      );

      fireEvent.keyDown(diagram, { key: "Enter" });
      fireEvent.keyDown(diagram, { key: " " });
      fireEvent.keyDown(diagram, { key: "a" });

      expect(mockLightbox?.openSrc).toHaveBeenCalledTimes(2);
    });

    it("is not a button when no lightbox provider is in scope", async () => {
      mockLightbox = null;
      renderMermaid.mockResolvedValue("<svg/>");
      const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);
      const diagram = await waitFor(
        () => container.querySelector(".mermaid-diagram") as HTMLElement,
      );
      expect(diagram.getAttribute("role")).toBeNull();
    });
  });
});
