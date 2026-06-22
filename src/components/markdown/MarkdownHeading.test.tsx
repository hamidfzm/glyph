import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownHeading } from "./MarkdownHeading";

Object.defineProperty(navigator, "clipboard", {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  configurable: true,
});

describe("MarkdownHeading", () => {
  it("renders the heading level matching the source node", () => {
    const { container } = render(
      <MarkdownHeading node={{ tagName: "h3" }} id="setup">
        Setup
      </MarkdownHeading>,
    );
    const heading = container.querySelector("h3");
    expect(heading).toBeTruthy();
    expect(heading?.getAttribute("id")).toBe("setup");
  });

  it("appends an anchor-copy button when the heading has an id", () => {
    render(
      <MarkdownHeading node={{ tagName: "h2" }} id="installation">
        Installation
      </MarkdownHeading>,
    );
    expect(screen.getByRole("button", { name: "Copy link to heading" })).toBeTruthy();
  });

  it("renders no anchor button when the heading has no id", () => {
    render(<MarkdownHeading node={{ tagName: "h2" }}>Untitled</MarkdownHeading>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("falls back to h1 when the node tagName is missing", () => {
    const { container } = render(<MarkdownHeading id="top">Top</MarkdownHeading>);
    expect(container.querySelector("h1")).toBeTruthy();
  });
});
