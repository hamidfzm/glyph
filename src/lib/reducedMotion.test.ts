import { afterEach, describe, expect, it } from "vitest";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { prefersReducedMotion, REDUCED_MOTION_QUERY, scrollBehavior } from "./reducedMotion";

afterEach(restoreMatchMedia);

describe("prefersReducedMotion", () => {
  it("reports the OS preference", () => {
    const media = stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(media.matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it("is false when the preference is off", () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false where matchMedia is unavailable", () => {
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("scrollBehavior", () => {
  it("jumps instead of animating when reduced motion is on", () => {
    stubMatchMedia(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("scrolls smoothly otherwise", () => {
    stubMatchMedia(false);
    expect(scrollBehavior()).toBe("smooth");
  });
});
