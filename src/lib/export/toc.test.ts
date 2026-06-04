import { describe, expect, it } from "vitest";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { buildTocElement, TOC_CLASS } from "./toc";

const ENTRIES: TocEntry[] = [
  { id: "intro", text: "Intro", level: 1 },
  { id: "details", text: "Details", level: 2 },
];

describe("buildTocElement", () => {
  it("builds a nav with one anchor per entry", () => {
    const nav = buildTocElement(ENTRIES);
    expect(nav.className).toBe(TOC_CLASS);
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("#intro");
    expect(links[1].textContent).toBe("Details");
  });

  it("indents deeper headings", () => {
    const nav = buildTocElement(ENTRIES);
    const items = nav.querySelectorAll("li");
    expect(items[0].style.paddingLeft).toBe("0px");
    expect(items[1].style.paddingLeft).toBe("16px");
  });

  it("produces an empty list for no entries", () => {
    const nav = buildTocElement([]);
    expect(nav.querySelectorAll("a")).toHaveLength(0);
  });
});
