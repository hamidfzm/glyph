import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectConsole } from "@/test/consoleGuard";
import { FencedMountSlot } from "./FencedMountSlot";

describe("FencedMountSlot", () => {
  it("mounts with the block's props and remounts when they change, cleaning up in between", () => {
    const cleanup = vi.fn();
    const openLightbox = vi.fn();
    const renderer = {
      mount: vi.fn((el: HTMLElement, { code }: { code: string }, registerCleanup) => {
        el.textContent = code;
        registerCleanup(cleanup);
      }),
    };

    const { container, rerender, unmount } = render(
      <FencedMountSlot renderer={renderer} code="a" openLightbox={openLightbox} />,
    );
    expect(container.textContent).toBe("a");
    expect(renderer.mount.mock.calls[0][1]).toEqual({ code: "a", openLightbox });

    rerender(<FencedMountSlot renderer={renderer} code="b" openLightbox={openLightbox} />);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("b");

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("mounts again over the previous render on a source change, and clears for a new renderer", () => {
    // A renderer that keeps what is on screen until it has something new.
    const keeper = {
      mount: (el: HTMLElement, { code }: { code: string }) => {
        if (!el.textContent) el.textContent = code;
      },
    };
    const { container, rerender } = render(<FencedMountSlot renderer={keeper} code="a" />);
    rerender(<FencedMountSlot renderer={keeper} code="b" />);
    expect(container.textContent).toBe("a");

    const other = {
      mount: (el: HTMLElement) => {
        el.append("other");
      },
    };
    rerender(<FencedMountSlot renderer={other} code="b" />);
    expect(container.textContent).toBe("other");
  });

  it("contains a mount that throws", () => {
    expectConsole(/threw in mount/);
    const renderer = {
      mount: () => {
        throw new Error("boom");
      },
    };
    const { container } = render(<FencedMountSlot renderer={renderer} code="a" />);
    expect(container.firstElementChild?.childElementCount).toBe(0);
  });
});
