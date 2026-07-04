import { describe, expect, it } from "vitest";
import { extractHeadingSection } from "./headingSection";

const DOC = [
  "# Intro",
  "top matter",
  "",
  "## Recipes",
  "pasta",
  "",
  "### Sauce",
  "tomato",
  "",
  "## Notes",
  "footer",
  "",
].join("\n");

describe("extractHeadingSection", () => {
  it("returns the heading and its body up to the next same-level heading", () => {
    expect(extractHeadingSection(DOC, "Recipes")).toBe("## Recipes\npasta\n\n### Sauce\ntomato");
  });

  it("includes nested deeper subheadings", () => {
    expect(extractHeadingSection(DOC, "Recipes")).toContain("### Sauce");
  });

  it("stops at a higher-level heading", () => {
    expect(extractHeadingSection(DOC, "Sauce")).toBe("### Sauce\ntomato");
  });

  it("matches by slug (case and spacing insensitive)", () => {
    expect(extractHeadingSection(DOC, "recipes")).toContain("pasta");
    const doc = "## My Heading\nbody";
    expect(extractHeadingSection(doc, "my-heading")).toBe("## My Heading\nbody");
  });

  it("returns empty when the heading is missing", () => {
    expect(extractHeadingSection(DOC, "Nope")).toBe("");
  });

  it("ignores headings inside fenced code blocks", () => {
    const doc = "## Real\ntext\n```\n## Fake\n```\nmore";
    expect(extractHeadingSection(doc, "Fake")).toBe("");
    expect(extractHeadingSection(doc, "Real")).toBe("## Real\ntext\n```\n## Fake\n```\nmore");
  });
});
