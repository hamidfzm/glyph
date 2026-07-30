import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionBarButton } from "./ActionBarButton";

describe("ActionBarButton", () => {
  it("uses the label as both accessible name and tooltip", () => {
    render(
      <ActionBarButton onClick={vi.fn()} label="Open graph">
        <span />
      </ActionBarButton>,
    );
    expect(screen.getByRole("button", { name: "Open graph" }).getAttribute("title")).toBe(
      "Open graph",
    );
  });

  it("keeps a shorter tooltip separate from the accessible name", () => {
    render(
      <ActionBarButton onClick={vi.fn()} label="View mode" title="View">
        <span />
      </ActionBarButton>,
    );
    expect(screen.getByRole("button", { name: "View mode" }).getAttribute("title")).toBe("View");
  });

  it("marks the active state for styling", () => {
    render(
      <ActionBarButton onClick={vi.fn()} label="Edit mode" active>
        <span />
      </ActionBarButton>,
    );
    expect(screen.getByRole("button", { name: "Edit mode" }).hasAttribute("data-active")).toBe(
      true,
    );
  });

  it("leaves the active attribute off when inactive", () => {
    render(
      <ActionBarButton onClick={vi.fn()} label="Edit mode" active={false}>
        <span />
      </ActionBarButton>,
    );
    expect(screen.getByRole("button", { name: "Edit mode" }).hasAttribute("data-active")).toBe(
      false,
    );
  });

  it("fires its callback on click", () => {
    const onClick = vi.fn();
    render(
      <ActionBarButton onClick={onClick} label="AI Chat">
        <span />
      </ActionBarButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI Chat" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
