import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Backlink } from "@/lib/plugins/types";
import { BacklinksList } from "./BacklinksList";
import type { BacklinksState } from "./backlinksStore";

const root = "/workspace";
const backlinks: Backlink[] = [
  { source: "/workspace/Index.md", line: 4, snippet: "see [[Cooking]]" },
  { source: "/workspace/Notes/Travel.md", line: 12, snippet: "ref to [[Cooking]] here" },
];

function fakeStore(rows: readonly Backlink[]) {
  let state: BacklinksState = { root, rows };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    show(next: readonly Backlink[]) {
      state = { root, rows: next };
      for (const listener of listeners) listener();
    },
  };
}

const defaultProps = {
  store: fakeStore(backlinks),
  emptyLabel: "No backlinks",
  onOpen: vi.fn(),
};

describe("BacklinksList", () => {
  it("shows the empty message without backlinks", () => {
    render(<BacklinksList {...defaultProps} store={fakeStore([])} />);
    expect(screen.getByText("No backlinks")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows one row per backlink, its path relative to the workspace root", () => {
    render(<BacklinksList {...defaultProps} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("Index.md")).toBeInTheDocument();
    expect(screen.getByText("Notes/Travel.md")).toBeInTheDocument();
    expect(screen.queryByText("No backlinks")).toBeNull();
  });

  it("renders snippets for each entry", () => {
    render(<BacklinksList {...defaultProps} />);
    expect(screen.getByText("see [[Cooking]]")).toBeInTheDocument();
    expect(screen.getByText("ref to [[Cooking]] here")).toBeInTheDocument();
  });

  it("invokes onOpen with source and line on click", () => {
    const onOpen = vi.fn();
    render(<BacklinksList {...defaultProps} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Notes\/Travel\.md/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith("/workspace/Notes/Travel.md", 12);
  });

  it("redraws when the store reports other rows", () => {
    const store = fakeStore([]);
    render(<BacklinksList {...defaultProps} store={store} />);

    act(() => store.show(backlinks));
    expect(screen.getByText("Index.md")).toBeInTheDocument();
    expect(screen.queryByText("No backlinks")).toBeNull();

    act(() => store.show([]));
    expect(screen.getByText("No backlinks")).toBeInTheDocument();
    expect(screen.queryByText("Index.md")).toBeNull();
  });
});
