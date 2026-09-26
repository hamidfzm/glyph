import { memo } from "react";
import { describe, expect, it } from "vitest";
import { isFencedRendererMount } from "./fencedRenderers";

describe("isFencedRendererMount", () => {
  it("tells a mount renderer from React components, memo ones included", () => {
    const Component = () => null;
    expect(isFencedRendererMount({ mount: () => {} })).toBe(true);
    expect(isFencedRendererMount(Component)).toBe(false);
    expect(isFencedRendererMount(memo(Component))).toBe(false);
  });
});
