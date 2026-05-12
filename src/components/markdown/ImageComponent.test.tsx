import { render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useImageComponent } from "./ImageComponent";

describe("useImageComponent", () => {
  it("passes through absolute URLs unchanged", () => {
    const { result } = renderHook(() => useImageComponent("/notes/doc.md"));
    const Img = result.current;
    const { container } = render(<Img src="https://example.com/x.png" alt="x" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/x.png");
  });

  it("passes through data URIs unchanged", () => {
    const { result } = renderHook(() => useImageComponent("/notes/doc.md"));
    const Img = result.current;
    const { container } = render(<Img src="data:image/png;base64,AAAA" alt="d" />);
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png/);
  });

  it("resolves relative paths via convertFileSrc (asset:// in tests)", () => {
    const { result } = renderHook(() => useImageComponent("/notes/doc.md"));
    const Img = result.current;
    const { container } = render(<Img src="img/cover.png" alt="c" />);
    const src = container.querySelector("img")?.getAttribute("src") ?? "";
    expect(src).toMatch(/^asset:\/\/localhost\//);
    expect(src).toContain("/notes/img/cover.png");
  });

  it("normalizes ./ segments out of the resolved path", () => {
    const { result } = renderHook(() => useImageComponent("/notes/doc.md"));
    const Img = result.current;
    const { container } = render(<Img src="./img/cover.png" alt="c" />);
    const src = container.querySelector("img")?.getAttribute("src") ?? "";
    expect(src).not.toContain("/./");
    expect(src).toContain("/notes/img/cover.png");
  });

  it("leaves the src alone when no file path is known", () => {
    const { result } = renderHook(() => useImageComponent(undefined));
    const Img = result.current;
    const { container } = render(<Img src="cover.png" alt="c" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("cover.png");
  });

  it("returns undefined when src is missing", () => {
    const { result } = renderHook(() => useImageComponent("/notes/doc.md"));
    const Img = result.current;
    const { container } = render(<Img alt="no-src" />);
    expect(container.querySelector("img")?.hasAttribute("src")).toBe(false);
  });
});
