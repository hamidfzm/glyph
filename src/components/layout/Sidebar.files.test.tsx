import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/Sidebar";
import { buildMetadataIndex } from "@/lib/metadata";
import { pickMoveDir } from "@/lib/pickers";
import { makeFileTab, makeWorkspace, renderSidebar, Wrapper } from "@/test/fixtures/sidebar";

vi.mock("@/lib/pickers", () => ({
  pickMoveDir: vi.fn(),
}));

describe("Sidebar files panel", () => {
  it("file toolbar creates at the root and collapses all when expanded", async () => {
    const createNote = vi.fn();
    const createFolder = vi.fn();
    const collapseAll = vi.fn();
    renderSidebar({
      workspace: makeWorkspace({ expanded: new Set(["/tmp/notes/sub"]) }),
      tabs: { createNote, createFolder, collapseAll },
    });

    fireEvent.click(screen.getByTitle("New note"));
    await waitFor(() => expect(createNote).toHaveBeenCalledWith("/tmp/notes"));
    fireEvent.click(screen.getByTitle("New folder"));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith("/tmp/notes"));

    fireEvent.click(screen.getByTitle("Collapse all"));
    expect(collapseAll).toHaveBeenCalledOnce();
  });

  it("file toolbar expands all when nothing is expanded", () => {
    const expandAll = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { expandAll } });
    fireEvent.click(screen.getByTitle("Expand all"));
    expect(expandAll).toHaveBeenCalledOnce();
  });

  it("closes the workspace from the files toolbar", () => {
    const closeWorkspace = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { closeWorkspace } });
    fireEvent.click(screen.getByTitle("Close workspace"));
    expect(closeWorkspace).toHaveBeenCalledOnce();
  });

  it("file menu duplicates, reveals, and moves an entry", async () => {
    vi.mocked(pickMoveDir).mockResolvedValue("/tmp/notes/sub");
    const duplicatePath = vi.fn();
    const movePath = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { duplicatePath, movePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Make a copy"));
    expect(duplicatePath).toHaveBeenCalledWith("/tmp/notes/readme.md");

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Show in system explorer"));
    expect(revealItemInDir).toHaveBeenCalledWith("/tmp/notes/readme.md");

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Move to…"));
    await waitFor(() =>
      expect(movePath).toHaveBeenCalledWith("/tmp/notes/readme.md", "/tmp/notes/sub"),
    );
  });

  it("creates a canvas in the entry's directory from the file menu", async () => {
    const createCanvas = vi.fn(async () => null);
    renderSidebar({ workspace: makeWorkspace(), tabs: { createCanvas } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("New Canvas"));
    await waitFor(() => expect(createCanvas).toHaveBeenCalledWith("/tmp/notes"));
  });

  it("renames an entry from the file menu", async () => {
    const renamePath = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { renamePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Rename"));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(renamePath).toHaveBeenCalledWith("/tmp/notes/readme.md", "renamed"));
  });

  it("deletes an entry from the file menu", async () => {
    const deletePath = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { deletePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(deletePath).toHaveBeenCalledWith("/tmp/notes/readme.md"));
  });

  it("Move to… does nothing when the picker is cancelled", async () => {
    vi.mocked(pickMoveDir).mockResolvedValue(null);
    const movePath = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { movePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Move to…"));
    await waitFor(() => expect(pickMoveDir).toHaveBeenCalled());
    expect(movePath).not.toHaveBeenCalled();
  });

  describe("tags", () => {
    const metadata = buildMetadataIndex([
      {
        path: "/tmp/notes/readme.md",
        frontmatter: "---\ntags: [work]\n---\n",
        tags: [],
      },
      { path: "/tmp/notes/deep/plan.md", frontmatter: null, tags: ["work"] },
      { path: "/tmp/notes/diary.md", frontmatter: null, tags: ["personal"] },
    ]);

    it("lists the workspace tags with their counts", () => {
      renderSidebar({ workspace: makeWorkspace(), tabs: { metadata } });
      expect(screen.getByText("Tags")).toBeInTheDocument();
      expect(screen.getByTitle("Filter by #work")).toBeInTheDocument();
      expect(screen.getByTitle("Filter by #personal")).toBeInTheDocument();
    });

    it("has no tags block when the workspace carries no metadata", () => {
      renderSidebar({ workspace: makeWorkspace() });
      expect(screen.queryByText("Tags")).not.toBeInTheDocument();
    });

    // The filtered list replaces the tree: matches can live in folders the
    // lazily-loaded tree has never expanded.
    it("replaces the tree with the tagged files when a tag is picked", () => {
      renderSidebar({ workspace: makeWorkspace(), tabs: { metadata } });
      fireEvent.click(screen.getByTitle("Filter by #work"));

      expect(screen.getByText("#work (2)")).toBeInTheDocument();
      expect(screen.getByText("deep/plan.md")).toBeInTheDocument();
      expect(screen.queryByText("diary.md")).not.toBeInTheDocument();
    });

    it("opens a tagged file from the filtered list", () => {
      const openFile = vi.fn();
      renderSidebar({ workspace: makeWorkspace(), tabs: { metadata, openFile } });
      fireEvent.click(screen.getByTitle("Filter by #personal"));
      fireEvent.click(screen.getByText("diary.md"));
      expect(openFile).toHaveBeenCalledWith("/tmp/notes/diary.md");
    });

    it("restores the tree when the filter is cleared", () => {
      renderSidebar({ workspace: makeWorkspace(), tabs: { metadata } });
      fireEvent.click(screen.getByTitle("Filter by #work"));
      fireEvent.click(screen.getByRole("button", { name: "Clear tag filter" }));
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.queryByText("#work (2)")).not.toBeInTheDocument();
    });

    it("clears the filter when the active tag chip is clicked again", () => {
      renderSidebar({ workspace: makeWorkspace(), tabs: { metadata } });
      fireEvent.click(screen.getByTitle("Filter by #work"));
      fireEvent.click(screen.getByTitle("Filter by #work"));
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.queryByText("#work (2)")).not.toBeInTheDocument();
    });

    it("hides the tree-only toolbar actions while a tag filters the panel", () => {
      renderSidebar({ workspace: makeWorkspace(), tabs: { metadata } });
      fireEvent.click(screen.getByTitle("Filter by #work"));
      expect(screen.queryByTitle("New note")).not.toBeInTheDocument();
      expect(screen.getByTitle("Close workspace")).toBeInTheDocument();
    });

    // Same tag name, different vault: the filter belongs to the workspace it
    // was picked in, so it must not silently re-apply to unrelated files.
    it("drops the filter when another workspace is opened", () => {
      const { rerender } = renderSidebar({ workspace: makeWorkspace(), tabs: { metadata } });
      fireEvent.click(screen.getByTitle("Filter by #work"));

      const opts = {
        activeTab: makeFileTab(),
        workspace: makeWorkspace({
          root: "/tmp/other",
          nodes: new Map([
            [
              "/tmp/other",
              [{ name: "other.md", path: "/tmp/other/other.md", isDirectory: false, modified: 0 }],
            ],
          ]),
        }),
        tabs: {
          metadata: buildMetadataIndex([
            { path: "/tmp/other/other.md", frontmatter: null, tags: ["work"] },
          ]),
        },
      };
      rerender(
        <Wrapper opts={opts}>
          <Sidebar side="left" />
        </Wrapper>,
      );
      expect(screen.getByText("other.md")).toBeInTheDocument();
      expect(screen.queryByText("#work (1)")).not.toBeInTheDocument();
    });

    // A rescan can drop the filtered tag (note deleted, tag edited away).
    it("falls back to the tree when the filtered tag leaves the index", () => {
      const { rerender } = renderSidebar({ workspace: makeWorkspace(), tabs: { metadata } });
      fireEvent.click(screen.getByTitle("Filter by #work"));
      expect(screen.getByText("#work (2)")).toBeInTheDocument();

      const opts = {
        activeTab: makeFileTab(),
        workspace: makeWorkspace(),
        tabs: { metadata: buildMetadataIndex([]) },
      };
      rerender(
        <Wrapper opts={opts}>
          <Sidebar side="left" />
        </Wrapper>,
      );
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.queryByText("#work (2)")).not.toBeInTheDocument();
    });
  });
});
