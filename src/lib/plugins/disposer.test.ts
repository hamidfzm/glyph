import { describe, expect, it, vi } from "vitest";
import { DisposerBag } from "./disposer";

describe("DisposerBag", () => {
  it("runs disposers most-recent first", () => {
    const order: number[] = [];
    const bag = new DisposerBag();
    bag.add(() => order.push(1));
    bag.add(() => order.push(2));
    bag.add(() => order.push(3));

    bag.dispose();

    expect(order).toEqual([3, 2, 1]);
  });

  it("is idempotent — disposing twice runs each disposer once", () => {
    const fn = vi.fn();
    const bag = new DisposerBag();
    bag.add(fn);

    bag.dispose();
    bag.dispose();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(bag.isDisposed).toBe(true);
  });

  it("runs a disposer immediately when added after disposal", () => {
    const bag = new DisposerBag();
    bag.dispose();

    const fn = vi.fn();
    bag.add(fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(bag.size).toBe(0);
  });

  it("keeps tearing down when a disposer throws", () => {
    const after = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bag = new DisposerBag();
    // `after` is added first, so it runs last (reverse order) — after the throw.
    bag.add(after);
    bag.add(() => {
      throw new Error("boom");
    });

    bag.dispose();

    expect(after).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports the number of pending disposers", () => {
    const bag = new DisposerBag();
    expect(bag.size).toBe(0);
    bag.add(() => {});
    bag.add(() => {});
    expect(bag.size).toBe(2);
    bag.dispose();
    expect(bag.size).toBe(0);
  });
});
