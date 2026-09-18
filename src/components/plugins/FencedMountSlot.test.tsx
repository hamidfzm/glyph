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
