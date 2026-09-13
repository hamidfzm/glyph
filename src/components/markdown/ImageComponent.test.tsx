import { render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useImageComponent } from "./ImageComponent";

// Without a workspace these render in single-file mode, where a local image's
// src arrives once the backend has mirrored its path.
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

  it("resolves relative paths via convertFileSrc (asset:// in tests)", async () => {
    const { result } = renderHook(() => useImageComponent("/notes/doc.md"));
    const Img = result.current;
    const { container } = render(<Img src="img/cover.png" alt="c" />);
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^asset:\/\/localhost\//),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toContain("/notes/img/cover.png");
  });

  it("normalizes ./ segments out of the resolved path", async () => {
    const { result } = renderHook(() => useImageComponent("/notes/doc.md"));
    const Img = result.current;
    const { container } = render(<Img src="./img/cover.png" alt="c" />);
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toContain("/notes/img/cover.png"),
    );
    expect(container.querySelector("img")?.getAttribute("src")).not.toContain("/./");
  });

  it("strips a Windows verbatim prefix and normalizes separators", async () => {
    const { result } = renderHook(() => useImageComponent("\\\\?\\C:\\Users\\me\\notes\\doc.md"));
    const Img = result.current;
    const { container } = render(<Img src="./diagram.svg" alt="d" />);
    const decoded = () =>
      decodeURIComponent(container.querySelector("img")?.getAttribute("src") ?? "");
    // The unreadable "\\?\" prefix and the stray forward slash from the join are gone.
    await waitFor(() => expect(decoded()).toContain("C:\\Users\\me\\notes\\diagram.svg"));
    expect(decoded()).not.toContain("\\\\?\\");
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
