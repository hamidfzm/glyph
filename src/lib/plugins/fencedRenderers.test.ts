import { memo } from "react";
import { describe, expect, it } from "vitest";
import { isFencedRendererMount } from "./fencedRenderers";

const Component = () => null;

describe("isFencedRendererMount", () => {
  it("tells a mount renderer from React components, memo ones included", () => {
    expect(isFencedRendererMount({ mount: () => {} })).toBe(true);
    expect(isFencedRendererMount(Component)).toBe(false);
    expect(isFencedRendererMount(memo(Component))).toBe(false);
  });
});
