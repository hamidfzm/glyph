import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownViewer } from "./MarkdownViewer";

vi.mock("./MermaidDiagram", () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-diagram">{code}</div>,
}));

function renderMd(content: string) {
  return render(<MarkdownViewer content={content} searchOpen={false} onSearchClose={() => {}} />);
}

describe("MarkdownViewer raw HTML", () => {
  it("renders allowed inline HTML elements", () => {
    const { container } = renderMd("Press <kbd>Cmd</kbd>+<kbd>K</kbd> for H<sub>2</sub>O.");
    expect(container.querySelectorAll("kbd")).toHaveLength(2);
    expect(container.querySelector("sub")?.textContent).toBe("2");
  });

  it("renders <details>/<summary> blocks", () => {
    const { container } = renderMd("<details>\n<summary>More</summary>\n\nhidden\n\n</details>");
    expect(container.querySelector("details")).not.toBeNull();
    expect(container.querySelector("summary")?.textContent).toBe("More");
  });

  it("strips <script> tags from raw HTML", () => {
    const { container } = renderMd("ok <script>alert('xss')</script> done");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("alert(");
  });

  it("strips on* event handlers", () => {
    const { container } = renderMd('<p onclick="alert(1)">click</p>');
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.getAttribute("onclick")).toBeNull();
  });

  it("strips javascript: URLs", () => {
    const { container } = renderMd("[bad](javascript:alert(1))");
    const a = container.querySelector("a");
    const href = a?.getAttribute("href") ?? "";
    expect(href.toLowerCase()).not.toMatch(/^javascript:/);
  });
});

describe("MarkdownViewer GitHub alerts", () => {
  const types = ["note", "tip", "important", "warning", "caution"] as const;

  for (const type of types) {
    it(`renders [!${type.toUpperCase()}] as a styled alert`, () => {
      const { container } = renderMd(`> [!${type.toUpperCase()}]\n> body text`);
      const alert = container.querySelector(`.markdown-alert.markdown-alert-${type}`);
      expect(alert).not.toBeNull();
      expect(alert?.querySelector(".markdown-alert-title")).not.toBeNull();
      expect(alert?.querySelector("svg")).not.toBeNull();
      expect(alert?.textContent).toContain("body text");
    });
  }

  it("leaves plain blockquotes untouched", () => {
    const { container } = renderMd("> just a quote");
    expect(container.querySelector(".markdown-alert")).toBeNull();
    expect(container.querySelector("blockquote")?.textContent?.trim()).toBe("just a quote");
  });
});
