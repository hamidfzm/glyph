import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { colorSchemeHarness } from "@/test/colorSchemeHarness";
import { ColorSchemeStyle } from "./ColorSchemeStyle";

const sheets = () =>
  [...document.querySelectorAll("style[data-color-scheme]")].map((el) => el.textContent);

describe("ColorSchemeStyle", () => {
  it("renders nothing for the default palette or without a provider", () => {
    render(<ColorSchemeStyle />);
    const { wrapper, offer } = colorSchemeHarness();
    offer("p", "ocean");
    render(<ColorSchemeStyle />, { wrapper });

    expect(sheets()).toEqual([]);
  });

  it("injects the picked scheme alone, and swaps it when the choice changes", () => {
    const { wrapper, offer, setSaved } = colorSchemeHarness({
      saved: { id: "p:ocean", label: "Ocean" },
    });
    offer("p", "ocean");
    offer("p", "reef");
    const { rerender } = render(<ColorSchemeStyle />, { wrapper });
    expect(sheets()).toEqual([":root{--scheme:ocean}"]);

    setSaved({ id: "p:reef", label: "Reef" });
    rerender(<ColorSchemeStyle />);
    expect(sheets()).toEqual([":root{--scheme:reef}"]);
  });

  it("leaves the default palette while the scheme's plugin is missing, and applies it when it returns", () => {
    const { wrapper, offer } = colorSchemeHarness({ saved: { id: "p:ocean", label: "Ocean" } });
    render(<ColorSchemeStyle />, { wrapper });
    expect(sheets()).toEqual([]);

    let remove = () => {};
    act(() => {
      remove = offer("p", "ocean");
    });
    expect(sheets()).toEqual([":root{--scheme:ocean}"]);

    act(() => remove());
    expect(sheets()).toEqual([]);
  });
});
