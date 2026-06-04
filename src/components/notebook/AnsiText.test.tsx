import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnsiText } from "./AnsiText";

const ESC = "\x1b";

describe("AnsiText", () => {
  it("renders plain text inside a pre", () => {
    const { container } = render(<AnsiText text="hello" />);
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toBe("hello");
  });

  it("applies ANSI colour classes to spans", () => {
    const { container } = render(<AnsiText text={`${ESC}[31mred${ESC}[0m`} />);
    const span = container.querySelector("span.ansi-fg-red");
    expect(span?.textContent).toBe("red");
  });

  it("passes through the className to the pre element", () => {
    const { container } = render(<AnsiText text="x" className="nb-output-text" />);
    expect(container.querySelector("pre")?.className).toBe("nb-output-text");
  });

  it("applies inline colour styles for 256/truecolour segments", () => {
    const { container } = render(<AnsiText text={`${ESC}[38;2;10;20;30mrgb`} />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.style.color).toBe("rgb(10, 20, 30)");
  });
});
