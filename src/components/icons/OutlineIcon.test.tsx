import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutlineIcon } from "./OutlineIcon";

describe("OutlineIcon", () => {
  it("renders an aria-hidden svg", () => {
    const { container } = render(<OutlineIcon />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("fills the bullets only when active", () => {
    const inactive = render(<OutlineIcon />);
    for (const circle of inactive.container.querySelectorAll("circle")) {
      expect(circle.getAttribute("fill")).toBe("none");
    }

    const active = render(<OutlineIcon active />);
    for (const circle of active.container.querySelectorAll("circle")) {
      expect(circle.getAttribute("fill")).toBe("currentColor");
    }
  });
});
