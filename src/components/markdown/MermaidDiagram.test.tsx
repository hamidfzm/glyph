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
});
