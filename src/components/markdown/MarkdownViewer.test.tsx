import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownViewer } from "./MarkdownViewer";

vi.mock("./MermaidDiagram", () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-diagram">{code}</div>,
}));

function renderMd(
  content: string,
  extra: Partial<React.ComponentProps<typeof MarkdownViewer>> = {},
) {
  return render(
    <MarkdownViewer content={content} searchOpen={false} onSearchClose={() => {}} {...extra} />,
  );
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

describe("MarkdownViewer task lists", () => {
  it("renders GFM task lists as visible checkboxes", () => {
    const { container } = renderMd("- [ ] todo\n- [x] done");
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      "li.task-list-item input[type=checkbox]",
    );
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    expect(container.querySelector("ul.contains-task-list")).not.toBeNull();
  });

  it("calls onTaskToggle with the source line when a checkbox is clicked", () => {
    const onTaskToggle = vi.fn();
    const { container } = renderMd("- [ ] one\n- [x] two", { onTaskToggle });
    const boxes = container.querySelectorAll<HTMLInputElement>(
      "li.task-list-item input[type=checkbox]",
    );
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(onTaskToggle).toHaveBeenNthCalledWith(1, 1);
    expect(onTaskToggle).toHaveBeenNthCalledWith(2, 2);
  });

  it("renders the clickable checkbox without the disabled attribute", () => {
    const { container } = renderMd("- [ ] todo");
    const box = container.querySelector<HTMLInputElement>("li.task-list-item input[type=checkbox]");
    expect(box).not.toBeNull();
    expect(box?.disabled).toBe(false);
  });
});

describe("MarkdownViewer footnotes", () => {
  // Regression: rehype-sanitize's default `clobber` option used to prepend
  // `user-content-` to every id, which doubled remark-gfm v4's already
  // prefixed footnote ids and broke `[^1]` click navigation.
  it("keeps footnote ref hrefs aligned with their target ids", () => {
    const { container } = renderMd("Text[^1].\n\n[^1]: The note.");
    const ref = container.querySelector("a[data-footnote-ref]") as HTMLAnchorElement | null;
    expect(ref).not.toBeNull();
    const targetId = ref!.getAttribute("href")!.slice(1);
    expect(container.querySelector(`#${CSS.escape(targetId)}`)).not.toBeNull();

    const back = container.querySelector("a[data-footnote-backref]") as HTMLAnchorElement | null;
    expect(back).not.toBeNull();
    const backTargetId = back!.getAttribute("href")!.slice(1);
    expect(container.querySelector(`#${CSS.escape(backTargetId)}`)).not.toBeNull();
  });
});

describe("MarkdownViewer wikilinks", () => {
  it("renders a resolved wikilink with the workspace path", () => {
    const { container } = renderMd("Open [[Cooking]] now.", {
      workspaceFiles: ["/vault/Cooking.md", "/vault/Other.md"],
    });
    const link = container.querySelector('a[data-wikilink="Cooking"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("data-wikilink-path")).toBe("/vault/Cooking.md");
    expect(link?.classList.contains("wikilink")).toBe(true);
    expect(link?.classList.contains("wikilink--broken")).toBe(false);
  });

  it("renders a missing wikilink with the broken modifier", () => {
    const { container } = renderMd("[[Missing]]", { workspaceFiles: ["/vault/Other.md"] });
    const link = container.querySelector('a[data-wikilink="Missing"]');
    expect(link).not.toBeNull();
    expect(link?.classList.contains("wikilink--broken")).toBe(true);
    expect(link?.getAttribute("aria-disabled")).toBe("true");
  });

  it("calls onOpenWikilink with the resolved path on click", () => {
    const onOpen = vi.fn();
    const { container } = renderMd("[[Cooking]]", {
      workspaceFiles: ["/vault/Cooking.md"],
      onOpenWikilink: onOpen,
    });
    const link = container.querySelector('a[data-wikilink="Cooking"]') as HTMLAnchorElement;
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith("/vault/Cooking.md", undefined);
  });
});
