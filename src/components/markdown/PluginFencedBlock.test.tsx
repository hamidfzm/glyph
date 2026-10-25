import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  FencedRendererContribution,
  FencedRendererMount,
  FencedRendererProps,
} from "@/lib/plugins/types";
import { PluginFencedBlock } from "./PluginFencedBlock";

function mountRenderer() {
  const seen: FencedRendererProps[] = [];
  const mount = vi.fn<FencedRendererMount["mount"]>((el, props) => {
    seen.push(props);
    el.textContent = props.code;
  });
  const renderer: FencedRendererContribution = { language: "demo", render: { mount } };
  return { renderer, mount, seen };
}

const defaultProps = { code: "old", startLine: 3, endLine: 5, onFencedBlockEdit: vi.fn() };

describe("PluginFencedBlock", () => {
  it("hands the renderer an updateCode that saves the block by its lines", async () => {
    const { renderer, seen } = mountRenderer();
    const onFencedBlockEdit = vi.fn().mockResolvedValue(true);
    render(
      <PluginFencedBlock
        {...defaultProps}
        renderer={renderer}
        onFencedBlockEdit={onFencedBlockEdit}
      />,
    );

    await expect(seen[0].updateCode?.("new")).resolves.toBe(true);
    expect(onFencedBlockEdit).toHaveBeenCalledWith(
      { startLine: 3, endLine: 5, code: "old" },
      "new",
    );
  });

  it("offers no updateCode without an edit handler", () => {
    const { renderer, seen } = mountRenderer();
    render(
      <PluginFencedBlock {...defaultProps} renderer={renderer} onFencedBlockEdit={undefined} />,
    );
    expect(seen[0].updateCode).toBeUndefined();
  });

  it("offers no updateCode when the block's lines are unknown", () => {
    const { renderer, seen } = mountRenderer();
    render(
      <PluginFencedBlock
        {...defaultProps}
        renderer={renderer}
        startLine={undefined}
        endLine={undefined}
      />,
    );
    expect(seen[0].updateCode).toBeUndefined();
  });

  it("keeps the renderer mounted when the block moves, saving at its new lines", async () => {
    const { renderer, mount, seen } = mountRenderer();
    const onFencedBlockEdit = vi.fn().mockResolvedValue(true);
    const props = { ...defaultProps, renderer, onFencedBlockEdit };
    const { rerender } = render(<PluginFencedBlock {...props} />);
    rerender(<PluginFencedBlock {...props} startLine={8} endLine={10} />);

    expect(mount).toHaveBeenCalledTimes(1);
    await seen[0].updateCode?.("new");
    expect(onFencedBlockEdit).toHaveBeenCalledWith(
      { startLine: 8, endLine: 10, code: "old" },
      "new",
    );
  });

  it("checks a save from an older render against the code that render showed", async () => {
    const { renderer, seen } = mountRenderer();
    const onFencedBlockEdit = vi.fn().mockResolvedValue(false);
    const props = { ...defaultProps, renderer, onFencedBlockEdit };
    const { rerender } = render(<PluginFencedBlock {...props} />);
    rerender(<PluginFencedBlock {...props} code="reloaded" />);

    await seen[0].updateCode?.("from the old render");
    expect(onFencedBlockEdit).toHaveBeenCalledWith(
      { startLine: 3, endLine: 5, code: "old" },
      "from the old render",
    );
  });

  it("refuses a save once the block is gone", async () => {
    const { renderer, seen } = mountRenderer();
    const onFencedBlockEdit = vi.fn();
    const { unmount } = render(
      <PluginFencedBlock
        {...defaultProps}
        renderer={renderer}
        onFencedBlockEdit={onFencedBlockEdit}
      />,
    );
    unmount();

    await expect(seen[0].updateCode?.("new")).resolves.toBe(false);
    expect(onFencedBlockEdit).not.toHaveBeenCalled();
  });

  it("passes updateCode to a React component renderer", () => {
    const renderer: FencedRendererContribution = {
      language: "demo",
      render: ({ updateCode }) => <div>{updateCode ? "editable" : "read-only"}</div>,
    };
    render(<PluginFencedBlock {...defaultProps} renderer={renderer} />);
    expect(screen.getByText("editable")).toBeInTheDocument();
  });

  it("marks the block for export with its language and source", () => {
    const { renderer } = mountRenderer();
    const { container } = render(
      <PluginFencedBlock {...defaultProps} renderer={renderer} code="src" />,
    );
    const block = container.querySelector("[data-fenced-language='demo']");
    expect(block?.getAttribute("data-fenced-source")).toBe("src");
  });
});
