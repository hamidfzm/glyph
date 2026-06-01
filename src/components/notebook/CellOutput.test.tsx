import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NotebookOutput } from "@/lib/notebook/types";
import { CellOutput } from "./CellOutput";

describe("CellOutput", () => {
  it("renders stream text", () => {
    const out: NotebookOutput = { kind: "stream", name: "stdout", text: "hello\n" };
    const { container } = render(<CellOutput output={out} />);
    expect(container.querySelector("pre")?.textContent).toBe("hello\n");
  });

  it("marks stderr streams with the stderr class", () => {
    const out: NotebookOutput = { kind: "stream", name: "stderr", text: "oops" };
    const { container } = render(<CellOutput output={out} />);
    expect(container.querySelector(".nb-output-stderr")).toBeTruthy();
  });

  it("renders a base64 PNG image output", () => {
    const out: NotebookOutput = {
      kind: "data",
      executionCount: 1,
      data: { "image/png": "AAAA" },
    };
    const { container } = render(<CellOutput output={out} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("prefers an image over text when both are present", () => {
    const out: NotebookOutput = {
      kind: "data",
      executionCount: 1,
      data: { "image/png": "AAAA", "text/plain": "<Figure>" },
    };
    const { container } = render(<CellOutput output={out} />);
    expect(container.querySelector("img")).toBeTruthy();
    expect(container.textContent).not.toContain("<Figure>");
  });

  it("renders an error traceback as preformatted text", () => {
    const out: NotebookOutput = {
      kind: "error",
      ename: "ValueError",
      evalue: "bad",
      traceback: ["line 1", "ValueError: bad"],
    };
    const { container } = render(<CellOutput output={out} />);
    expect(container.querySelector(".nb-output-error")?.textContent).toContain("ValueError: bad");
  });

  it("shows a placeholder for unsupported interactive output", () => {
    const out: NotebookOutput = {
      kind: "data",
      executionCount: null,
      data: { "application/vnd.plotly.v1+json": "{}" },
    };
    render(<CellOutput output={out} />);
    expect(screen.getByText(/not supported yet/i)).toBeInTheDocument();
  });

  it("renders plain text output", () => {
    const out: NotebookOutput = {
      kind: "data",
      executionCount: 2,
      data: { "text/plain": "42" },
    };
    const { container } = render(<CellOutput output={out} />);
    expect(container.textContent).toContain("42");
  });

  it("renders an SVG image output via a data URL", () => {
    const out: NotebookOutput = {
      kind: "data",
      executionCount: null,
      data: { "image/svg+xml": "<svg></svg>" },
    };
    const { container } = render(<CellOutput output={out} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("data:image/svg+xml;utf8,");
    expect(img?.getAttribute("src")).toContain(encodeURIComponent("<svg></svg>"));
  });

  it("renders sanitized HTML output", () => {
    const out: NotebookOutput = {
      kind: "data",
      executionCount: 1,
      data: { "text/html": "<strong>bold</strong>" },
    };
    const { container } = render(<CellOutput output={out} />);
    expect(container.querySelector(".nb-output-html")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders markdown output through the markdown pipeline", () => {
    const out: NotebookOutput = {
      kind: "data",
      executionCount: 1,
      data: { "text/markdown": "# heading" },
    };
    const { container } = render(<CellOutput output={out} />);
    expect(container.querySelector(".nb-output-markdown")).toBeTruthy();
    expect(container.querySelector("h1")?.textContent).toBe("heading");
  });

  it("shows a generic placeholder for an unsupported non-interactive type", () => {
    const out: NotebookOutput = {
      kind: "data",
      executionCount: null,
      data: { "application/json": "{}" },
    };
    render(<CellOutput output={out} />);
    expect(screen.getByText(/unsupported output/i)).toBeInTheDocument();
  });
});
