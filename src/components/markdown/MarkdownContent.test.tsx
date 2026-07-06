import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@/lib/settings";
import { renderInWorkspace } from "@/test/renderInWorkspace";
import { MarkdownContent } from "./MarkdownContent";

// Overridable settings for the feature-toggle tests; null falls through to the
// real hook so every other test keeps the defaults.
let mockSettings: Settings | null = null;
vi.mock("@/hooks/useSettings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/hooks/useSettings")>();
  return {
    ...orig,
    useSettings: () => {
      const real = orig.useSettings();
      return mockSettings ? { ...real, settings: mockSettings } : real;
    },
  };
});

afterEach(() => {
  mockSettings = null;
});

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

  it("renders task-list items and routes toggles to onTaskToggle", () => {
    const onTaskToggle = vi.fn();
    render(
      <MarkdownContent
        content={"- [ ] first\n- [x] second"}
        showFrontmatter={false}
        onTaskToggle={onTaskToggle}
      />,
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[1]).toBeChecked();

    fireEvent.click(boxes[0]);
    expect(onTaskToggle).toHaveBeenCalledWith(1);
  });

  it("lazily renders math via KaTeX", async () => {
    const { container } = render(
      <MarkdownContent content={"inline $x^2$ math"} showFrontmatter={false} />,
    );
    await waitFor(() => expect(container.querySelector(".katex")).toBeTruthy());
  });

  it("leaves math syntax literal when the feature is toggled off", async () => {
    const { DEFAULT_SETTINGS } = await import("@/lib/settings");
    mockSettings = {
      ...DEFAULT_SETTINGS,
      markdown: { ...DEFAULT_SETTINGS.markdown, math: false },
    };
    const { container } = render(
      <MarkdownContent content={"inline $x^2$ math"} showFrontmatter={false} />,
    );
    expect(container.textContent).toContain("$x^2$");
    expect(container.querySelector(".katex")).toBeNull();
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

  it("does not resolve a relative link when the document has no file path", () => {
    const onOpen = vi.fn();
    const { container } = renderInWorkspace(
      <MarkdownContent
        content={"[sib](./sibling.md)"}
        onOpenRelativeFile={onOpen}
        showFrontmatter={false}
      />,
    );
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
