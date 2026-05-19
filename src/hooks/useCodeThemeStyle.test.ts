import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCodeThemeStyle } from "./useCodeThemeStyle";

// Vite's `?inline` CSS imports resolve to an empty string under the vitest
// environment, so these tests cover the DOM lifecycle (element creation,
// reuse, identity) rather than the actual stylesheet bytes.

afterEach(() => {
  document.getElementById("glyph-code-theme")?.remove();
});

describe("useCodeThemeStyle", () => {
  it('creates a <style id="glyph-code-theme"> on first render', () => {
    renderHook(() => useCodeThemeStyle("github"));
    const el = document.getElementById("glyph-code-theme");
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("STYLE");
  });

  it("reuses the same element across theme changes instead of stacking", () => {
    const { rerender } = renderHook((theme: string) => useCodeThemeStyle(theme), {
      initialProps: "github",
    });
    const first = document.getElementById("glyph-code-theme");
    rerender("monokai");
    const second = document.getElementById("glyph-code-theme");
    expect(second).toBe(first);
    expect(document.querySelectorAll("#glyph-code-theme")).toHaveLength(1);
  });

  it("tolerates an unknown theme without throwing", () => {
    expect(() => renderHook(() => useCodeThemeStyle("does-not-exist"))).not.toThrow();
    expect(document.getElementById("glyph-code-theme")).not.toBeNull();
  });
});
