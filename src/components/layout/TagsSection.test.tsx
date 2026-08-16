import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TagCount } from "@/lib/metadata";
import { TagsSection } from "./TagsSection";

const tags: TagCount[] = [
  { tag: "work", count: 3 },
  { tag: "ideas", count: 1 },
];

const nested: TagCount[] = [
  { tag: "project", count: 2 },
  { tag: "project/glyph", count: 1 },
];

const defaultProps = {
  tags,
  selected: null,
  collapsed: false,
  onToggleCollapsed: vi.fn(),
  onSelect: vi.fn(),
};

/** Chip text in render order, which is what the sort toggle changes. */
function chipLabels() {
  return screen.getAllByTitle(/^Filter by/).map((chip) => chip.textContent ?? "");
}

describe("TagsSection", () => {
  it("keeps the heading and shows an empty message without tags", () => {
    render(<TagsSection {...defaultProps} tags={[]} />);
    expect(screen.getByText("Tags")).toBeTruthy();
    expect(screen.getByText("No tags")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sort tags by count" })).toBeNull();
  });

  it("shows one chip per tag with its count", () => {
    render(<TagsSection {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Filter by #work" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter by #ideas" })).toBeTruthy();
  });

  it("selects a tag on click", () => {
    const onSelect = vi.fn();
    render(<TagsSection {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by #work" }));
    expect(onSelect).toHaveBeenCalledWith("work");
  });

  it("clears the filter when the selected tag is clicked again", () => {
    const onSelect = vi.fn();
    render(<TagsSection {...defaultProps} selected="work" onSelect={onSelect} />);
    const chip = screen.getByRole("button", { name: "Filter by #work" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("reports a header click instead of collapsing itself", () => {
    const onToggleCollapsed = vi.fn();
    render(<TagsSection {...defaultProps} onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole("button", { name: /^Tags/ }));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Filter by #work" })).toBeTruthy();
  });

  it("hides the chips and the sort toggle when collapsed", () => {
    render(<TagsSection {...defaultProps} collapsed={true} />);
    expect(screen.queryByRole("button", { name: "Filter by #work" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sort tags by count" })).toBeNull();
  });

  it("lists tags alphabetically until the sort is toggled to frequency", () => {
    render(<TagsSection {...defaultProps} />);
    expect(chipLabels()).toEqual(["#ideas1", "#work3"]);

    const toggle = screen.getByRole("button", { name: "Sort tags by count" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(chipLabels()).toEqual(["#work3", "#ideas1"]);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(chipLabels()).toEqual(["#ideas1", "#work3"]);
  });

  it("nests a tag under its parent and labels it with the last segment", () => {
    render(<TagsSection {...defaultProps} tags={nested} />);
    const child = screen.getByRole("button", { name: "Filter by #project/glyph" });
    expect(child.textContent).toBe("#glyph1");

    const parent = screen.getByRole("button", { name: "Filter by #project" });
    expect(parent.parentElement?.contains(child)).toBe(true);
  });

  it("selects a nested tag by its full path, not the label it shows", () => {
    const onSelect = vi.fn();
    render(<TagsSection {...defaultProps} tags={nested} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by #project/glyph" }));
    expect(onSelect).toHaveBeenCalledWith("project/glyph");
  });
});
