import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { Command } from "@/lib/commands";
import { buildMetadataIndex } from "@/lib/metadata";
import { CommandPalette } from "./CommandPalette";

function cmd(over: Partial<Command>): Command {
  return {
    id: over.id ?? over.title ?? "x",
    title: over.title ?? "Untitled",
    section: over.section ?? "Commands",
    run: over.run ?? vi.fn(),
    ...over,
  };
}

function renderPalette(props: {
  open?: boolean;
  query?: string;
  commands?: Command[];
  onQueryChange?: (q: string) => void;
  onClose?: () => void;
}) {
  const merged = {
    open: props.open ?? true,
    query: props.query ?? "",
    commands: props.commands ?? [],
    onQueryChange: props.onQueryChange ?? vi.fn(),
    onClose: props.onClose ?? vi.fn(),
  };
  return { ...render(<CommandPalette {...merged} />), ...merged };
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = renderPalette({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("shows section headers for matching sections only", () => {
    renderPalette({
      commands: [
        cmd({ id: "note1", title: "First Note", section: "Files" }),
        cmd({ id: "open", title: "Open File", section: "Commands" }),
      ],
    });
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.queryByText("Headings")).not.toBeInTheDocument();
  });

  it("filters by query and shows empty state when nothing matches", () => {
    renderPalette({
      query: "xyz",
      commands: [cmd({ title: "Open File" })],
    });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("invokes the top match on Enter and closes the palette", () => {
    const onClose = vi.fn();
    const run = vi.fn();
    renderPalette({
      query: "open",
      commands: [cmd({ id: "open", title: "Open File", run })],
      onClose,
    });
    const input = screen.getByLabelText("Command palette query");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves selection with ArrowDown / ArrowUp and runs the highlighted item", () => {
    const a = vi.fn();
    const b = vi.fn();
    renderPalette({
      commands: [
        cmd({ id: "a", title: "Alpha", section: "Commands", run: a }),
        cmd({ id: "b", title: "Beta", section: "Commands", run: b }),
      ],
    });
    const input = screen.getByLabelText("Command palette query");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
  });

  it("ArrowUp at the top stays at index 0", () => {
    const a = vi.fn();
    const b = vi.fn();
    renderPalette({
      commands: [cmd({ id: "a", title: "Alpha", run: a }), cmd({ id: "b", title: "Beta", run: b })],
    });
    const input = screen.getByLabelText("Command palette query");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(a).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderPalette({ onClose });
    fireEvent.keyDown(screen.getByLabelText("Command palette query"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("forwards query changes via onQueryChange", () => {
    const onQueryChange = vi.fn();
    renderPalette({ onQueryChange });
    fireEvent.change(screen.getByLabelText("Command palette query"), {
      target: { value: "file" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("file");
  });

  it("clicking outside the inner palette closes it", () => {
    const onClose = vi.fn();
    const { container } = renderPalette({ onClose });
    fireEvent.click(container.querySelector(".command-palette-overlay") as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking an item runs it and closes", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    renderPalette({
      commands: [cmd({ id: "x", title: "Run X", run })],
      onClose,
    });
    fireEvent.click(screen.getByText("Run X"));
    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("highlights matched characters with <mark>", () => {
    const { container } = renderPalette({
      query: "op",
      commands: [cmd({ title: "Open Folder" })],
    });
    expect(container.querySelectorAll("mark").length).toBeGreaterThan(0);
  });

  it("clicking inside the inner palette does not close it", () => {
    const onClose = vi.fn();
    const { container } = renderPalette({
      onClose,
      commands: [cmd({ title: "Anything" })],
    });
    fireEvent.click(container.querySelector(".command-palette") as Element);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hovering an item moves selection to it", () => {
    const a = vi.fn();
    const b = vi.fn();
    renderPalette({
      commands: [cmd({ id: "a", title: "Alpha", run: a }), cmd({ id: "b", title: "Beta", run: b })],
    });
    fireEvent.mouseEnter(screen.getByText("Beta"));
    fireEvent.keyDown(screen.getByLabelText("Command palette query"), { key: "Enter" });
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
  });

  it("Escape fired directly on the overlay also closes", () => {
    const onClose = vi.fn();
    const { container } = renderPalette({ onClose });
    const overlay = container.querySelector(".command-palette-overlay") as Element;
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("non-Escape keys on the overlay are ignored", () => {
    const onClose = vi.fn();
    const { container } = renderPalette({ onClose });
    const overlay = container.querySelector(".command-palette-overlay") as Element;
    fireEvent.keyDown(overlay, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Enter with no matches is a no-op", () => {
    const onClose = vi.fn();
    renderPalette({
      query: "zzz",
      commands: [cmd({ title: "Open File" })],
      onClose,
    });
    fireEvent.keyDown(screen.getByLabelText("Command palette query"), { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("other keys in the input are ignored by the palette handler", () => {
    const onClose = vi.fn();
    renderPalette({ onClose });
    fireEvent.keyDown(screen.getByLabelText("Command palette query"), { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ArrowDown does not go past the last item", () => {
    const a = vi.fn();
    const b = vi.fn();
    renderPalette({
      commands: [cmd({ id: "a", title: "Alpha", run: a }), cmd({ id: "b", title: "Beta", run: b })],
    });
    const input = screen.getByLabelText("Command palette query");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
  });

  it("renders the shortcut hint when provided", () => {
    renderPalette({
      commands: [cmd({ title: "Open File", shortcut: "Cmd+O" })],
    });
    expect(screen.getByText("Cmd+O")).toBeInTheDocument();
  });

  it("renders the subtitle when provided", () => {
    renderPalette({
      commands: [cmd({ title: "note.md", subtitle: "/workspace/note.md", section: "Files" })],
    });
    expect(screen.getByText("/workspace/note.md")).toBeInTheDocument();
  });

  it("renders the leading icon when provided, and an empty slot when not", () => {
    const { container } = renderPalette({
      commands: [
        cmd({ id: "with", title: "With Icon", icon: () => <svg aria-label="icon" role="img" /> }),
        cmd({ id: "without", title: "Without Icon" }),
      ],
    });
    expect(screen.getByRole("img", { name: "icon" })).toBeInTheDocument();
    // Both rows keep the slot, so titles stay aligned when only some have icons.
    expect(container.querySelectorAll(".command-palette-icon")).toHaveLength(2);
    expect(screen.getByText("Without Icon")).toBeInTheDocument();
  });

  it("focuses the input when opened", () => {
    renderPalette({});
    expect(document.activeElement).toBe(screen.getByLabelText("Command palette query"));
  });

  it("narrows Files rows to a tag query using the workspace metadata", () => {
    const metadata = buildMetadataIndex([
      { path: "/ws/spec.md", frontmatter: null, tags: ["work"] },
      { path: "/ws/diary.md", frontmatter: null, tags: ["personal"] },
    ]);
    render(
      <TabsContext.Provider value={{ metadata } as unknown as TabsContextValue}>
        <CommandPalette
          open
          query="tag:work"
          commands={[
            cmd({ id: "spec", title: "spec.md", section: "Files", path: "/ws/spec.md" }),
            cmd({ id: "diary", title: "diary.md", section: "Files", path: "/ws/diary.md" }),
            cmd({ id: "settings", title: "Settings" }),
          ]}
          onQueryChange={vi.fn()}
          onClose={vi.fn()}
        />
      </TabsContext.Provider>,
    );

    expect(screen.getByText("spec.md")).toBeInTheDocument();
    expect(screen.queryByText("diary.md")).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });
});
