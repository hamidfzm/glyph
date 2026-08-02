import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TagCount } from "@/lib/metadata";
import { TagsSection } from "./TagsSection";

const tags: TagCount[] = [
  { tag: "work", count: 3 },
  { tag: "ideas", count: 1 },
];

describe("TagsSection", () => {
  it("renders nothing without tags", () => {
    const { container } = render(<TagsSection tags={[]} selected={null} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows one chip per tag with its count", () => {
    render(<TagsSection tags={tags} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /work/ })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("button", { name: /ideas/ })).toBeTruthy();
  });

  it("selects a tag on click", () => {
    const onSelect = vi.fn();
    render(<TagsSection tags={tags} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /work/ }));
    expect(onSelect).toHaveBeenCalledWith("work");
  });

  it("clears the filter when the selected tag is clicked again", () => {
    const onSelect = vi.fn();
    render(<TagsSection tags={tags} selected="work" onSelect={onSelect} />);
    const chip = screen.getByRole("button", { name: /work/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("collapses on header click", () => {
    render(<TagsSection tags={tags} selected={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Tags/ }));
    expect(screen.queryByRole("button", { name: /work/ })).toBeNull();
  });
});
