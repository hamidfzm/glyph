import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TagCount } from "@/lib/plugins/types";
import { TagsPanel } from "./TagsPanel";
import { createTagsStore } from "./tagsStore";

const tags: TagCount[] = [
  { tag: "work", count: 3 },
  { tag: "ideas", count: 1 },
];

const nested: TagCount[] = [
  { tag: "project", count: 2 },
  { tag: "project/glyph", count: 1 },
];

const defaultProps = {
  emptyLabel: "No tags",
  filterLabel: (tag: string) => `Filter by #${tag}`,
};

/** The real store over a fake workspace index, with `counts` already loaded. */
async function storeWith(counts: TagCount[]) {
  const ctx = {
    vault: {
      tags: vi.fn(async () => counts),
      pathsWithTag: vi.fn(async () => []),
      onChange: vi.fn(() => vi.fn()),
    },
    workspace: { getRoot: vi.fn(() => "/workspace"), onChange: vi.fn(() => vi.fn()) },
    ui: { filterFileTree: vi.fn(() => vi.fn()) },
  };
  const store = createTagsStore(
    ctx as unknown as Parameters<typeof createTagsStore>[0],
    (tag, total) => `#${tag} (${total})`,
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return store;
}

/** Chip text in render order, which is what the sort changes. */
function chipLabels() {
  return screen.getAllByRole("button", { name: /^Filter by/ }).map((chip) => chip.textContent);
}

describe("TagsPanel", () => {
  it("shows an empty message without tags", async () => {
    render(<TagsPanel {...defaultProps} store={await storeWith([])} />);
    expect(screen.getByText("No tags")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows one chip per tag with its count", async () => {
    render(<TagsPanel {...defaultProps} store={await storeWith(tags)} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Filter by #work" })).toHaveTextContent("#work3");
    expect(screen.getByRole("button", { name: "Filter by #ideas" })).toHaveTextContent("#ideas1");
    expect(screen.queryByText("No tags")).toBeNull();
  });

  it("selects a tag on click", async () => {
    const store = await storeWith(tags);
    render(<TagsPanel {...defaultProps} store={store} />);
    const chip = screen.getByRole("button", { name: "Filter by #work" });
    expect(chip).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chip);
    expect(store.get().selected).toBe("work");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Filter by #ideas" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clears the filter when the selected tag is clicked again", async () => {
    const store = await storeWith(tags);
    store.select("work");
    render(<TagsPanel {...defaultProps} store={store} />);
    const chip = screen.getByRole("button", { name: "Filter by #work" });
    expect(chip).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chip);
    expect(store.get().selected).toBeNull();
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("lists tags alphabetically until the store sorts them by count", async () => {
    const store = await storeWith(tags);
    render(<TagsPanel {...defaultProps} store={store} />);
    expect(chipLabels()).toEqual(["#ideas1", "#work3"]);

    act(() => store.toggleSort());
    expect(chipLabels()).toEqual(["#work3", "#ideas1"]);

    act(() => store.toggleSort());
    expect(chipLabels()).toEqual(["#ideas1", "#work3"]);
  });

  it("nests a tag under its parent and labels it with the last segment", async () => {
    render(<TagsPanel {...defaultProps} store={await storeWith(nested)} />);
    const child = screen.getByRole("button", { name: "Filter by #project/glyph" });
    expect(child).toHaveTextContent("#glyph1");

    const parent = screen.getByRole("button", { name: "Filter by #project" });
    expect(parent.parentElement).toContainElement(child);
  });

  it("selects a nested tag by its full path, not the label it shows", async () => {
    const store = await storeWith(nested);
    render(<TagsPanel {...defaultProps} store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by #project/glyph" }));
    expect(store.get().selected).toBe("project/glyph");
  });
});
