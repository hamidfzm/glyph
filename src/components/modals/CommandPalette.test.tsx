import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Command } from "@/lib/commands";
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
});
