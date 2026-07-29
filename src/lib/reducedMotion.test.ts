import { afterEach, describe, expect, it } from "vitest";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { REDUCED_MOTION_QUERY, scrollBehavior } from "./reducedMotion";

afterEach(restoreMatchMedia);

describe("scrollBehavior", () => {
  it("jumps instead of animating when reduced motion is on", () => {
    const media = stubMatchMedia(true);
    expect(scrollBehavior()).toBe("instant");
    expect(media.matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it("scrolls smoothly when the preference is off", () => {
    stubMatchMedia(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("scrolls smoothly where matchMedia is unavailable", () => {
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = undefined;
    expect(scrollBehavior()).toBe("smooth");
  });
});
