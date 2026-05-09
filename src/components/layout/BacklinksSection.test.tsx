import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Backlink } from "@/lib/backlinks";
import { BacklinksSection } from "./BacklinksSection";

const root = "/vault";
const backlinks: Backlink[] = [
  { source: "/vault/Index.md", line: 4, snippet: "see [[Cooking]]" },
  { source: "/vault/Notes/Travel.md", line: 12, snippet: "ref to [[Cooking]] here" },
];

describe("BacklinksSection", () => {
  it("renders nothing when there are no backlinks", () => {
    const { container } = render(
      <BacklinksSection backlinks={[]} workspaceRoot={root} onOpen={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the count and one row per backlink", () => {
    render(<BacklinksSection backlinks={backlinks} workspaceRoot={root} onOpen={vi.fn()} />);
    expect(screen.getByText("Backlinks")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Index.md")).toBeTruthy();
    expect(screen.getByText("Notes/Travel.md")).toBeTruthy();
  });

  it("renders snippets for each entry", () => {
    render(<BacklinksSection backlinks={backlinks} workspaceRoot={root} onOpen={vi.fn()} />);
    expect(screen.getByText("see [[Cooking]]")).toBeTruthy();
    expect(screen.getByText("ref to [[Cooking]] here")).toBeTruthy();
  });

  it("invokes onOpen with source and line on click", () => {
    const onOpen = vi.fn();
    render(<BacklinksSection backlinks={backlinks} workspaceRoot={root} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Index.md"));
    expect(onOpen).toHaveBeenCalledWith("/vault/Index.md", 4);
  });

  it("collapses on header click", () => {
    render(<BacklinksSection backlinks={backlinks} workspaceRoot={root} onOpen={vi.fn()} />);
    const header = screen.getByRole("button", { name: /backlinks/i });
    fireEvent.click(header);
    expect(screen.queryByText("Index.md")).toBeNull();
  });
});
