import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  it("renders nothing when content is null", () => {
    const { container } = render(<StatusBar content={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when content is undefined", () => {
    const { container } = render(<StatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders word count and reading time", () => {
    render(<StatusBar content="hello world test" />);
    expect(screen.getByText("3 words")).toBeInTheDocument();
    expect(screen.getByText("1 min read")).toBeInTheDocument();
  });

  it("displays file path when provided", () => {
    render(<StatusBar filePath="/path/to/file.md" content="some content" />);
    expect(screen.getByText("/path/to/file.md")).toBeInTheDocument();
  });

  it("does not display file path when not provided", () => {
    render(<StatusBar content="some content" />);
    expect(screen.queryByText(/\//)).toBeNull();
  });
});
