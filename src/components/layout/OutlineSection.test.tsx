import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutlineSection } from "./OutlineSection";

const { scrollToHeading } = vi.hoisted(() => ({ scrollToHeading: vi.fn() }));
vi.mock("@/lib/scrollToHeading", () => ({ scrollToHeading }));

const entries = [
  { id: "intro", text: "Intro", level: 1 },
  { id: "usage", text: "Usage", level: 2 },
];

describe("OutlineSection", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = render(<OutlineSection entries={[]} activeId="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one indented button per heading", () => {
    const { getByRole } = render(<OutlineSection entries={entries} activeId="" />);
    expect(getByRole("button", { name: "Intro" }).style.paddingLeft).toBe("8px");
    expect(getByRole("button", { name: "Usage" }).style.paddingLeft).toBe("20px");
  });

  it("highlights the active heading", () => {
    const { getByRole } = render(<OutlineSection entries={entries} activeId="usage" />);
    expect(getByRole("button", { name: "Usage" }).className).toContain("bg-[var(--color-accent)]");
    expect(getByRole("button", { name: "Intro" }).className).not.toContain(
      "bg-[var(--color-accent)]",
    );
  });

  it("scrolls to the heading on click", () => {
    const { getByRole } = render(<OutlineSection entries={entries} activeId="" />);
    fireEvent.click(getByRole("button", { name: "Usage" }));
    expect(scrollToHeading).toHaveBeenCalledWith("usage");
  });
});
