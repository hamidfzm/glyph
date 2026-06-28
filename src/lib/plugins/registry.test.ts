import { describe, expect, it, vi } from "vitest";
import { createRegistry } from "./registry";

describe("createRegistry", () => {
  it("lists registered entries in insertion order", () => {
    const reg = createRegistry<string>();
    reg.register("a");
    reg.register("b");
    expect(reg.list()).toEqual(["a", "b"]);
  });

  it("removes an entry when its disposer runs", () => {
    const reg = createRegistry<string>();
    const dispose = reg.register("a");
    reg.register("b");

    dispose();

    expect(reg.list()).toEqual(["b"]);
  });

  it("notifies subscribers on register and unregister", () => {
    const reg = createRegistry<string>();
    const listener = vi.fn();
    reg.subscribe(listener);

    const dispose = reg.register("a");
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not notify after a redundant disposer call", () => {
    const reg = createRegistry<string>();
    const dispose = reg.register("a");
    const listener = vi.fn();
    reg.subscribe(listener);

    dispose();
    dispose();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying once a subscriber unsubscribes", () => {
    const reg = createRegistry<string>();
    const listener = vi.fn();
    const unsubscribe = reg.subscribe(listener);

    unsubscribe();
    reg.register("a");

    expect(listener).not.toHaveBeenCalled();
  });

  it("returns an independent snapshot from list()", () => {
    const reg = createRegistry<string>();
    reg.register("a");
    const snapshot = reg.list();
    reg.register("b");
    expect(snapshot).toEqual(["a"]);
  });

  it("returns the same snapshot reference until the registry changes", () => {
    const reg = createRegistry<string>();
    reg.register("a");
    // Stable between mutations, required for useSyncExternalStore snapshots.
    expect(reg.list()).toBe(reg.list());
    reg.register("b");
    expect(reg.list()).toBe(reg.list());
  });
});
