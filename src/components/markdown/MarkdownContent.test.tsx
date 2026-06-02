import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

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
});
