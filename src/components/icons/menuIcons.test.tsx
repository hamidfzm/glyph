import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import * as menuIcons from "./menuIcons";

describe("menuIcons", () => {
  it("renders every exported icon as an svg", () => {
    const entries = Object.entries(menuIcons);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, Icon] of entries) {
      const Cmp = Icon as ComponentType<{ className?: string }>;
      const { container, unmount } = render(<Cmp className="opacity-80" />);
      expect(container.querySelector("svg"), name).not.toBeNull();
      unmount();
    }
  });
});
