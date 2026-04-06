import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExternalLinkIcon } from "./ExternalLinkIcon";

describe("ExternalLinkIcon", () => {
  it("renders an svg element", () => {
    const { container } = render(<ExternalLinkIcon />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("has aria-hidden attribute for accessibility", () => {
    const { container } = render(<ExternalLinkIcon />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("has correct dimensions", () => {
    const { container } = render(<ExternalLinkIcon />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("12");
    expect(svg?.getAttribute("height")).toBe("12");
  });
});
