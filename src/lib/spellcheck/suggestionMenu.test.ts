import { afterEach, describe, expect, it, vi } from "vitest";
import { openSuggestionMenu, type SuggestionMenuLabels } from "./suggestionMenu";

const labels: SuggestionMenuLabels = { ignore: "Ignore", add: "Add", empty: "No suggestions" };

function base() {
  return { x: 10, y: 20, labels, onPick: vi.fn(), onIgnore: vi.fn(), onAdd: vi.fn() };
}

function menuCount() {
  return document.querySelectorAll(".spellcheck-menu").length;
}

afterEach(() => {
  // Close any menu left open so its document listeners don't leak between tests.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  document.body.innerHTML = "";
});

describe("openSuggestionMenu", () => {
  it("lists suggestions plus Ignore and Add, and applies the picked word", () => {
    const opts = { ...base(), suggestions: ["hello", "help"] };
    openSuggestionMenu(opts);

    const items = document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-item");
    expect([...items].map((i) => i.textContent)).toEqual(["hello", "help", "Ignore", "Add"]);
    expect(menuCount()).toBe(1);

    items[0].click();
    expect(opts.onPick).toHaveBeenCalledWith("hello");
    expect(menuCount()).toBe(0); // closes after an action
  });

  it("shows the empty label when there are no suggestions", () => {
    openSuggestionMenu({ ...base(), suggestions: [] });
    expect(document.querySelector(".spellcheck-menu-empty")?.textContent).toBe("No suggestions");
    expect(document.querySelectorAll(".spellcheck-menu-item")).toHaveLength(2); // just Ignore + Add
  });

  it("invokes Ignore and Add from the action buttons", () => {
    const ignoreOpts = { ...base(), suggestions: ["a"] };
    openSuggestionMenu(ignoreOpts);
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-action")[0].click();
    expect(ignoreOpts.onIgnore).toHaveBeenCalled();

    const addOpts = { ...base(), suggestions: ["a"] };
    openSuggestionMenu(addOpts);
    document.querySelectorAll<HTMLButtonElement>(".spellcheck-menu-action")[1].click();
    expect(addOpts.onAdd).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    openSuggestionMenu({ ...base(), suggestions: ["a"] });
    expect(menuCount()).toBe(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menuCount()).toBe(0);
  });

  it("closes on an outside click but not an inside one", () => {
    openSuggestionMenu({ ...base(), suggestions: ["a"] });
    const menu = document.querySelector(".spellcheck-menu");
    menu?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menuCount()).toBe(1);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menuCount()).toBe(0);
  });

  it("closes the previous menu when a new one opens", () => {
    openSuggestionMenu({ ...base(), suggestions: ["first"] });
    openSuggestionMenu({ ...base(), suggestions: ["second"] });
    expect(menuCount()).toBe(1);
    expect(document.querySelector(".spellcheck-menu-item")?.textContent).toBe("second");
  });
});
