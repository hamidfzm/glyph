import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContextMenuItem } from "@/lib/contextMenuItems";
import { ContextMenu } from "./ContextMenu";

function menu(items: ContextMenuItem[]) {
  return { x: 10, y: 20, items };
}

describe("ContextMenu", () => {
  it("renders nothing when there is no menu", () => {
    const { container } = render(<ContextMenu menu={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("runs an action and closes on click", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        menu={menu([{ kind: "action", label: "Open File…", onSelect }])}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Open File…" }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders separators between groups", () => {
    render(
      <ContextMenu
        menu={menu([
          { kind: "action", label: "Select All", onSelect: vi.fn() },
          { kind: "separator" },
          { kind: "action", label: "Open File…", onSelect: vi.fn() },
        ])}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("closes on Escape but ignores other keys", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        menu={menu([{ kind: "action", label: "Open File…", onSelect: vi.fn() }])}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on an outside mousedown but not on an inside one", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        menu={menu([{ kind: "action", label: "Open File…", onSelect: vi.fn() }])}
        onClose={onClose}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Open File…" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("expands a submenu and runs a nested action", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        menu={menu([
          {
            kind: "submenu",
            label: "AI",
            items: [{ kind: "action", label: "Summarize Document", onSelect }],
          },
        ])}
        onClose={onClose}
      />,
    );

    // Submenu collapsed initially.
    expect(screen.queryByRole("menuitem", { name: "Summarize Document" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "AI" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Summarize Document" }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("toggles a submenu closed when its parent is clicked again", () => {
    render(
      <ContextMenu
        menu={menu([
          {
            kind: "submenu",
            label: "AI",
            items: [{ kind: "action", label: "Summarize Document", onSelect: vi.fn() }],
          },
        ])}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "AI" }));
    expect(screen.getByRole("menuitem", { name: "Summarize Document" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "AI" }));
    expect(screen.queryByRole("menuitem", { name: "Summarize Document" })).toBeNull();
  });

  it("clamps the menu back inside the viewport when it would overflow", () => {
    const big = {
      width: 10000,
      height: 10000,
      top: 0,
      left: 0,
      right: 10000,
      bottom: 10000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(big);

    render(
      <ContextMenu
        menu={{ x: 99999, y: 99999, items: [{ kind: "action", label: "X", onSelect: vi.fn() }] }}
        onClose={vi.fn()}
      />,
    );

    const surface = screen.getByRole("menu");
    expect(surface.style.left).toBe("4px");
    expect(surface.style.top).toBe("4px");
    vi.restoreAllMocks();
  });

  it("suppresses the native menu on a right-click inside the surface", () => {
    render(
      <ContextMenu
        menu={menu([{ kind: "action", label: "Open File…", onSelect: vi.fn() }])}
        onClose={vi.fn()}
      />,
    );
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    screen.getByRole("menu").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
