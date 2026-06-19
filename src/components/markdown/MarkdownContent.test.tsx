import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceRootContext } from "@/contexts/WorkspaceRootContext";
import { MarkdownContent } from "./MarkdownContent";

// Render with an opened workspace root in context (the value MarkdownContent now
// reads via useWorkspaceRoot instead of a prop).
function renderInWorkspace(ui: ReactNode, root = "/ws") {
  return render(<WorkspaceRootContext.Provider value={root}>{ui}</WorkspaceRootContext.Provider>);
}

// MarkdownContent is the shared rendering core (frontmatter + ReactMarkdown with
// the full plugin set). MarkdownViewer.test covers the sanitiser/alert paths via
// the viewer; these tests target the branches unique to this component: the
// frontmatter toggle and the lazily-pushed highlight / katex plugins.
describe("MarkdownContent", () => {
  it("renders a frontmatter block when showFrontmatter is on", () => {
    render(<MarkdownContent content={"---\ntitle: Hello\n---\n\nbody"} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("skips the frontmatter block when showFrontmatter is off", () => {
    const { container } = render(
      <MarkdownContent content={"---\ntitle: Hidden\n---\n\nbody"} showFrontmatter={false} />,
    );
    // The raw frontmatter is not rendered as a metadata heading.
    expect(container.textContent).not.toContain("Hidden");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("lazily applies syntax highlighting to fenced code", async () => {
    const { container } = render(
      <MarkdownContent content={"```python\nx = 1\n```"} showFrontmatter={false} />,
    );
    await waitFor(() => expect(container.querySelector("code.hljs")).toBeTruthy());
  });

  it("lazily renders math via KaTeX", async () => {
    const { container } = render(
      <MarkdownContent content={"inline $x^2$ math"} showFrontmatter={false} />,
    );
    await waitFor(() => expect(container.querySelector(".katex")).toBeTruthy());
  });

  it("resolves a relative link against the document and opens it in the workspace", () => {
    const onOpen = vi.fn();
    const { container } = renderInWorkspace(
      <MarkdownContent
        content={"[sib](./sibling.md)"}
        filePath="/ws/notes/doc.md"
        onOpenRelativeFile={onOpen}
        showFrontmatter={false}
      />,
    );
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(onOpen).toHaveBeenCalledWith("/ws/notes/sibling.md");
  });

  it("blocks a relative link that resolves outside the workspace root", () => {
    const onOpen = vi.fn();
    const { container } = renderInWorkspace(
      <MarkdownContent
        content={"[esc](../../etc/passwd.md)"}
        filePath="/ws/notes/doc.md"
        onOpenRelativeFile={onOpen}
        showFrontmatter={false}
      />,
    );
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not wire relative-link opening without a workspace root (single-file mode)", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <MarkdownContent
        content={"[sib](./sibling.md)"}
        filePath="/loose/doc.md"
        onOpenRelativeFile={onOpen}
        showFrontmatter={false}
      />,
    );
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
