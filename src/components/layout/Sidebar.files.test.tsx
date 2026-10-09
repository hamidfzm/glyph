import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/Sidebar";
import { PluginsContext } from "@/contexts/PluginsContext";
import { pickMoveDir } from "@/lib/pickers";
import { createRegistry } from "@/lib/plugins/registry";
import type { FileTreeFilter } from "@/lib/plugins/types";
import { pluginsContextValue } from "@/test/fixtures/pluginsContext";
import {
  makeFileTab,
  makeWorkspace,
  type RenderOpts,
  renderSidebar,
  Wrapper,
} from "@/test/fixtures/sidebar";

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

  describe("file tree filter", () => {
    const work: FileTreeFilter = {
      label: "#work (2)",
      paths: ["/tmp/notes/readme.md", "/tmp/notes/deep/plan.md"],
      onClear: vi.fn(),
    };

    function renderFiltered(filter: FileTreeFilter, opts: RenderOpts = {}) {
      const fileTreeFilters = createRegistry<FileTreeFilter>();
      const remove = fileTreeFilters.register(filter);
      const fullOpts = { activeTab: makeFileTab(), workspace: makeWorkspace(), ...opts };
      render(
        <PluginsContext.Provider value={pluginsContextValue({ fileTreeFilters })}>
          <Wrapper opts={fullOpts}>
            <Sidebar side="left" />
          </Wrapper>
        </PluginsContext.Provider>,
      );
      return { fileTreeFilters, remove };
    }

    // The filtered list replaces the tree: matches can live in folders the
    // lazily-loaded tree has never expanded.
    it("replaces the tree with the files a plugin filters it to", () => {
      renderFiltered(work);
      expect(screen.getByText("#work (2)")).toBeInTheDocument();
      expect(screen.getByText("deep/plan.md")).toBeInTheDocument();
    });

    it("opens a file from the filtered list", () => {
      const openFile = vi.fn();
      renderFiltered(work, { tabs: { openFile } });
      fireEvent.click(screen.getByText("deep/plan.md"));
      expect(openFile).toHaveBeenCalledWith("/tmp/notes/deep/plan.md");
    });

    it("hands the clear button to the plugin that owns the filter", () => {
      const onClear = vi.fn();
      renderFiltered({ ...work, onClear });
      fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
      expect(onClear).toHaveBeenCalledOnce();
    });

    it("restores the tree when the plugin removes its filter", () => {
      const { remove } = renderFiltered(work);
      act(() => remove());
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.queryByText("#work (2)")).not.toBeInTheDocument();
    });

    it("hides the tree-only toolbar actions while a filter replaces the tree", () => {
      renderFiltered(work);
      expect(screen.queryByTitle("New note")).not.toBeInTheDocument();
      expect(screen.getByTitle("Close workspace")).toBeInTheDocument();
    });

    it("shows the newest filter when plugins register more than one", () => {
      const { fileTreeFilters } = renderFiltered(work);
      act(() => {
        fileTreeFilters.register({
          label: "#personal (1)",
          paths: ["/tmp/notes/diary.md"],
          onClear: vi.fn(),
        });
      });
      expect(screen.getByText("#personal (1)")).toBeInTheDocument();
      expect(screen.queryByText("#work (2)")).not.toBeInTheDocument();
    });
  });
});
