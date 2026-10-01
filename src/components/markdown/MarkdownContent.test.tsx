import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { CORE_PLUGINS, coreInstalledPlugin } from "@/lib/plugins/corePlugins";
import { createPluginHost } from "@/lib/plugins/host";
import { renderInWorkspace } from "@/test/renderInWorkspace";
import { MarkdownContent } from "./MarkdownContent";

// The math core plugin, loaded into a real host the way the app loads it.
async function mathHost() {
  const host = createPluginHost(vi.fn());
  const core = CORE_PLUGINS.find((plugin) => plugin.id === "glyph.core.math");
  if (!core) throw new Error("math core plugin missing");
  await host.load(coreInstalledPlugin(core), core.load);
  const value = {
    remarkPlugins: host.remarkPlugins,
    rehypePlugins: host.rehypePlugins,
  } as unknown as PluginsContextValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>
  );
  return { host, wrapper };
}

async function withMathPlugin() {
  return (await mathHost()).wrapper;
}

// MarkdownContent is the shared rendering core (frontmatter + ReactMarkdown with
// the full plugin set). MarkdownViewer.test covers the sanitiser/alert paths via
// the viewer; these tests target the branches unique to this component: the
// frontmatter toggle and the lazily-pushed highlight and plugin contributions.
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

  it("renders math through the math plugin once KaTeX loads, marked with its source", async () => {
    const { container } = render(
      <MarkdownContent content={"inline $x^2$ math"} showFrontmatter={false} />,
      { wrapper: await withMathPlugin() },
    );
    await waitFor(() =>
      expect(container.querySelector('[data-math-source="x^2"] .katex')).toBeTruthy(),
    );
  });

  it("keeps a display math block's source line for split view scroll sync", async () => {
    const { container } = render(
      <MarkdownContent content={"intro\n\n$$\nx + y\n$$"} showFrontmatter={false} sourceLines />,
      { wrapper: await withMathPlugin() },
    );
    await waitFor(() => expect(container.querySelector("[data-math-display] .katex")).toBeTruthy());
    const block = container.querySelector("[data-math-display]");
    expect(block?.getAttribute("data-line")).toBe("3");
    expect(block?.getAttribute("data-math-source")).toBe("x + y");
  });

  it("renders math beside a wikilink and an emoji shortcode", async () => {
    const { container } = render(
      <MarkdownContent content={"[[Note]] $a$ :smile:"} showFrontmatter={false} />,
      { wrapper: await withMathPlugin() },
    );
    await waitFor(() =>
      expect(container.querySelector('[data-math-source="a"] .katex')).toBeTruthy(),
    );
    await waitFor(() => expect(container.textContent).toContain("\u{1F604}"));
    expect(container.textContent).toContain("Note");
  });

  it("dispatches a standalone note embed to the embed renderer", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      Promise.resolve(
        cmd === "vault_resolve" ? ["/ws/Note.md"] : "embedded body",
      )) as unknown as typeof invoke);
    const { container } = renderInWorkspace(
      <MarkdownContent
        content={"![[Note]]"}
        filePath="/ws/doc.md"
        workspaceFiles={["/ws/Note.md"]}
        showFrontmatter={false}
      />,
      "/ws",
    );
    // The `<div class="markdown-embed">` placeholder routes through DivComponent
    // to EmbedComponent, which reads the target and renders it inline.
    await screen.findByText("embedded body");
    expect(container.querySelector(".markdown-embed")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("read_file", { path: "/ws/Note.md" });
  });

  it("strips a math marker a document writes itself, so exports never trust it", () => {
    const { container } = render(
      <MarkdownContent
        content={'<div data-math-source="x" data-math-display="">forged</div>'}
        showFrontmatter={false}
      />,
    );
    expect(container.textContent).toContain("forged");
    expect(container.querySelector("[data-math-source], [data-math-display]")).toBeNull();
  });

  it("drops back to plain text when the math plugin is turned off", async () => {
    const { host, wrapper } = await mathHost();
    const { container } = render(
      <MarkdownContent content={"inline $x^2$ math"} showFrontmatter={false} />,
      { wrapper },
    );
    await waitFor(() => expect(container.querySelector(".katex")).toBeTruthy());

    act(() => host.unload("glyph.core.math"));
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$x^2$");
  });

  it("leaves math syntax literal without the math plugin", () => {
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
