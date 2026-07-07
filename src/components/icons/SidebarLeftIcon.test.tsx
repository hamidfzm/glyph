import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SidebarLeftIcon } from "./SidebarLeftIcon";

describe("SidebarLeftIcon", () => {
  it("renders an aria-hidden svg", () => {
    const { container } = render(<SidebarLeftIcon />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("fills the panel area only when active", () => {
    const inactive = render(<SidebarLeftIcon />);
    expect(inactive.container.querySelectorAll("rect")).toHaveLength(1);

    const active = render(<SidebarLeftIcon active />);
    expect(active.container.querySelectorAll("rect")).toHaveLength(2);
  });
});
