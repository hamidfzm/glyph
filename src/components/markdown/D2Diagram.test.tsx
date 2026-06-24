import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D2Diagram } from "./D2Diagram";

const renderD2 = vi.fn();

vi.mock("@/lib/d2Render", () => ({
  renderD2: (...args: unknown[]) => renderD2(...args),
}));

describe("D2Diagram", () => {
  beforeEach(() => {
    renderD2.mockReset();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("renders the diagram SVG into the container on mount", async () => {
    renderD2.mockResolvedValue("<svg data-test='d'></svg>");
    const { container } = render(<D2Diagram code="x -> y" />);

    await waitFor(() => {
      const svg = container.querySelector(".d2-diagram svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("data-test")).toBe("d");
    });
    expect(renderD2).toHaveBeenCalledWith("x -> y", false);
  });

  it("renders in the dark theme when the document is in dark mode", async () => {
    renderD2.mockResolvedValue("<svg></svg>");
    document.documentElement.classList.add("dark");
    render(<D2Diagram code="x -> y" />);

    await waitFor(() => {
      expect(renderD2).toHaveBeenCalledWith("x -> y", true);
    });
  });

  it("shows the error fallback with the raw source when render rejects", async () => {
    renderD2.mockRejectedValue(new Error("bad d2"));
    const { container } = render(<D2Diagram code="garbage" />);

    await waitFor(() => {
      expect(container.querySelector(".d2-error")).not.toBeNull();
    });
    expect(container.querySelector("pre code")?.textContent).toBe("garbage");
  });

  it("recovers from the error state once the code becomes valid", async () => {
    renderD2.mockRejectedValueOnce(new Error("bad d2"));
    renderD2.mockResolvedValue("<svg data-test='ok'></svg>");
    const { container, rerender } = render(<D2Diagram code="garbage" />);

    await waitFor(() => expect(container.querySelector(".d2-error")).not.toBeNull());

    rerender(<D2Diagram code="a -> b" />);
    await waitFor(() => {
      expect(container.querySelector(".d2-error")).toBeNull();
      expect(container.querySelector(".d2-diagram svg")?.getAttribute("data-test")).toBe("ok");
    });
  });

  it("flags empty/whitespace-only source without calling the renderer", async () => {
    renderD2.mockResolvedValue("<svg></svg>");
    const { container } = render(<D2Diagram code={"   \n\t  "} />);

    await waitFor(() => {
      expect(container.querySelector(".d2-error")).not.toBeNull();
    });
    expect(renderD2).not.toHaveBeenCalled();
  });

  it("exposes the source via data-d2-source so PDF export can re-render it", async () => {
    renderD2.mockResolvedValue("<svg></svg>");
    const { container } = render(<D2Diagram code="a -> b" />);

    await waitFor(() => expect(container.querySelector(".d2-diagram")).not.toBeNull());
    expect(container.querySelector(".d2-diagram")?.getAttribute("data-d2-source")).toBe("a -> b");
  });

  it("falls back to a generic error message when render rejects with a non-Error value", async () => {
    // Exercises the non-Error branch of `err instanceof Error ? ... : ...`.
    renderD2.mockRejectedValue("not an Error instance");
    const { container } = render(<D2Diagram code="garbage" />);

    await waitFor(() => {
      expect(container.querySelector(".d2-error")).not.toBeNull();
    });
  });

  it("only the latest concurrent render writes its SVG to the DOM", async () => {
    // The first (light) render hangs; a theme flip starts a second (dark) render
    // that resolves first and wins. When the stale first render finally settles,
    // the sequence guard must drop it instead of overwriting the winner.
    type Resolver = (value: string) => void;
    const firstRender: { resolve: Resolver } = { resolve: () => {} };
    renderD2.mockImplementationOnce(
      () => new Promise<string>((resolve) => (firstRender.resolve = resolve)),
    );
    renderD2.mockResolvedValueOnce("<svg id='winner'></svg>");

    const { container } = render(<D2Diagram code="x -> y" />);
    document.documentElement.classList.add("dark");

    await waitFor(() => expect(container.querySelector("svg#winner")).not.toBeNull());

    firstRender.resolve("<svg id='stale'></svg>");
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector("svg#stale")).toBeNull();
    expect(container.querySelector("svg#winner")).not.toBeNull();
  });

  it("skips the DOM write when the container ref is null at resolution time", async () => {
    // Unmount mid-render: the awaited continuation runs after the ref is nulled,
    // so the `if (containerRef.current)` guard's false branch fires.
    type Resolver = (value: string) => void;
    const pending: { resolve: Resolver } = { resolve: () => {} };
    renderD2.mockImplementationOnce(
      () => new Promise<string>((resolve) => (pending.resolve = resolve)),
    );

    const { unmount } = render(<D2Diagram code="x -> y" />);
    await waitFor(() => expect(renderD2).toHaveBeenCalled());
    unmount();
    pending.resolve("<svg id='post-unmount'></svg>");
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector("svg#post-unmount")).toBeNull();
  });

  it("does not flip into the error UI when a stale render rejects after a newer one wins", async () => {
    // Symmetry with the success guard: a stale rejection arriving after a newer
    // render has painted must not switch the component into the error state.
    type Rejecter = (reason: unknown) => void;
    const firstRender: { reject: Rejecter } = { reject: () => {} };
    renderD2.mockImplementationOnce(
      () => new Promise<string>((_resolve, reject) => (firstRender.reject = reject)),
    );
    renderD2.mockResolvedValueOnce("<svg id='winner'></svg>");

    const { container } = render(<D2Diagram code="x -> y" />);
    document.documentElement.classList.add("dark");

    await waitFor(() => expect(container.querySelector("svg#winner")).not.toBeNull());

    firstRender.reject(new Error("stale failure"));
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector(".d2-error")).toBeNull();
    expect(container.querySelector("svg#winner")).not.toBeNull();
  });
});
