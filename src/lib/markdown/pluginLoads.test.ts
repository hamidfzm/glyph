import { describe, expect, it } from "vitest";
import { pendingPluginLoads, trackPluginLoad } from "./pluginLoads";

describe("trackPluginLoad", () => {
  it("counts a load while it is in flight and stops counting when it lands", async () => {
    let settle = (_: string) => {};
    const tracked = trackPluginLoad(
      new Promise<string>((resolve) => {
        settle = resolve;
      }),
    );
    expect(pendingPluginLoads()).toBe(1);

    settle("plugin");
    await expect(tracked).resolves.toBe("plugin");
    expect(pendingPluginLoads()).toBe(0);
  });

  it("stops counting a load that fails, and still rejects", async () => {
    const tracked = trackPluginLoad(Promise.reject(new Error("chunk load failed")));
    await expect(tracked).rejects.toThrow("chunk load failed");
    expect(pendingPluginLoads()).toBe(0);
  });

  it("counts concurrent loads independently", async () => {
    let settleFirst = () => {};
    const first = trackPluginLoad(
      new Promise<void>((resolve) => {
        settleFirst = resolve;
      }),
    );
    const second = trackPluginLoad(Promise.resolve());
    expect(pendingPluginLoads()).toBe(2);

    await second;
    expect(pendingPluginLoads()).toBe(1);

    settleFirst();
    await first;
    expect(pendingPluginLoads()).toBe(0);
  });
});
