import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginToasts } from "./PluginToasts";

describe("PluginToasts", () => {
  it("renders nothing when there is nothing to show", () => {
    const { container } = render(<PluginToasts toasts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stacks every toast as a live status region", () => {
    render(
      <PluginToasts
        toasts={[
          { id: 1, message: "first" },
          { id: 2, message: "second" },
        ]}
      />,
    );
    const toasts = screen.getAllByRole("status");
    expect(toasts.map((el) => el.textContent)).toEqual(["first", "second"]);
  });

  it("separates a failure from an informational toast by more than colour", () => {
    render(
      <PluginToasts
        toasts={[
          { id: 1, message: "installed" },
          { id: 2, message: "broke", tone: "error" },
        ]}
      />,
    );
    const [info, error] = screen.getAllByRole("status");
    expect(error.className).toContain("--color-error");
    expect(info.className).not.toContain("--color-error");
  });

  // The stack sits above the modal backdrop so failures raised from the plugins
  // modal stay readable; it must not eat the clicks meant for the modal.
  it("does not intercept pointer events", () => {
    const { container } = render(<PluginToasts toasts={[{ id: 1, message: "hi" }]} />);
    expect(container.firstElementChild?.className).toContain("pointer-events-none");
  });
});
