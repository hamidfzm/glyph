import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { headingComponents } from "./HeadingComponent";

describe("headingComponents", () => {
  it("creates all heading levels", () => {
    expect(headingComponents.h1).toBeDefined();
    expect(headingComponents.h2).toBeDefined();
    expect(headingComponents.h3).toBeDefined();
    expect(headingComponents.h4).toBeDefined();
    expect(headingComponents.h5).toBeDefined();
    expect(headingComponents.h6).toBeDefined();
  });

  it("renders h1 with id from slugified text", () => {
    const H1 = headingComponents.h1;
    const { container } = render(<H1>Hello World</H1>);
    const h1 = container.querySelector("h1");
    expect(h1?.id).toBe("hello-world");
    expect(h1?.textContent).toBe("Hello World");
  });

  it("renders h2 with correct tag", () => {
    const H2 = headingComponents.h2;
    const { container } = render(<H2>Section Title</H2>);
    const h2 = container.querySelector("h2");
    expect(h2).toBeTruthy();
    expect(h2?.id).toBe("section-title");
  });

  it("handles special characters in heading text", () => {
    const H3 = headingComponents.h3;
    const { container } = render(<H3>API Reference (v2.0)</H3>);
    const h3 = container.querySelector("h3");
    expect(h3?.id).toBe("api-reference-v20");
  });

  it("handles non-string children", () => {
    const H1 = headingComponents.h1;
    const { container } = render(<H1>{42}</H1>);
    const h1 = container.querySelector("h1");
    expect(h1?.id).toBe("42");
  });

  it("preserves extra props", () => {
    const H1 = headingComponents.h1;
    const { container } = render(<H1 className="custom">Test</H1>);
    const h1 = container.querySelector("h1");
    expect(h1?.className).toBe("custom");
  });
});
