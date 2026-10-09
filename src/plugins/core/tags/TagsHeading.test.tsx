import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TagCount } from "@/lib/plugins/types";
import { TagsHeading } from "./TagsHeading";
import { createTagsStore } from "./tagsStore";

const tags: TagCount[] = [
  { tag: "work", count: 3 },
  { tag: "ideas", count: 1 },
];

const defaultProps = { sortLabel: "Sort tags by count" };

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

describe("TagsHeading", () => {
  it("shows how many tags the workspace has", async () => {
    render(<TagsHeading {...defaultProps} store={await storeWith(tags)} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows a zero count and no sort toggle without tags", async () => {
    render(<TagsHeading {...defaultProps} store={await storeWith([])} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("toggles the sort from a button named by the sort label", async () => {
    const store = await storeWith(tags);
    render(<TagsHeading {...defaultProps} store={store} />);
    const toggle = screen.getByRole("button", { name: "Sort tags by count" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(store.get().sort).toBe("count");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(store.get().sort).toBe("name");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("follows a sort the store changed elsewhere", async () => {
    const store = await storeWith(tags);
    render(<TagsHeading {...defaultProps} store={store} />);

    act(() => store.toggleSort());
    expect(screen.getByRole("button", { name: "Sort tags by count" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
