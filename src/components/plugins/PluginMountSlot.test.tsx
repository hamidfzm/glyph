import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PluginMountSlot } from "./PluginMountSlot";

describe("PluginMountSlot", () => {
  it("mounts the contribution into the host element", () => {
    const { container } = render(
      <PluginMountSlot
        contribution={{
          id: "x",
          mount: (el) => {
            el.textContent = "hi";
          },
        }}
      />,
    );
    expect(container.querySelector('[data-plugin-slot="x"]')?.textContent).toBe("hi");
  });

  it("runs registered cleanup on unmount", () => {
    const cleanup = vi.fn();
    const { unmount } = render(
      <PluginMountSlot
        contribution={{
          id: "x",
          mount: (el, registerCleanup) => {
            el.textContent = "hi";
            registerCleanup(cleanup);
          },
        }}
      />,
    );
    expect(cleanup).not.toHaveBeenCalled();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("contains a throwing mount without crashing the tree", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <PluginMountSlot
          contribution={{
            id: "boom",
            mount: () => {
              throw new Error("nope");
            },
          }}
        />,
      ),
    ).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
