import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";
import { convertHtmlToPdf } from "./htmlToPdf";
import { prepareContent } from "./prepareContent";

// End-to-end guard for the reported "note embeds missing on export" bug: render
// a real embed through MarkdownContent, then run the actual export path
// (prepareContent + the PDF walker) over the live DOM. Everything read-only
// (the embedded note body, its heading) must survive; the interactive tool
// buttons (embed "open source", heading anchor) must not.
async function renderEmbedded(
  content: string,
  body = "## Section\n\nEMBED_BODY",
  waitText = "EMBED_BODY",
) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "read_file") return body;
    return undefined as unknown as string;
  });
  render(
    // MarkdownViewer wraps rendered markdown in `.markdown-body`; mirror it so
    // prepareContent's `document.querySelector(".markdown-body")` finds it.
    <div className="markdown-body">
      <MarkdownContent
        content={content}
        filePath="/ws/doc.md"
        workspaceFiles={["/ws/Note.md"]}
        onOpenWikilink={vi.fn()}
        showFrontmatter={false}
      />
    </div>,
  );
  await waitFor(() => expect(screen.getByText(waitText)).toBeInTheDocument());
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("note embeds on export", () => {
  it("keeps the embedded note body in the prepared HTML", async () => {
    await renderEmbedded("intro\n\n![[Note]]\n\noutro");
    const prepared = await prepareContent({ entries: [], includeToc: false });
    expect(prepared?.html).toContain("EMBED_BODY");
    // Surrounding document content is untouched.
    expect(prepared?.html).toContain("intro");
    expect(prepared?.html).toContain("outro");
  });

  it("strips the embed's open-source tool button from the export", async () => {
    await renderEmbedded("![[Note]]");
    const prepared = await prepareContent({ entries: [], includeToc: false });
    expect(prepared?.html).not.toContain("markdown-embed__source");
    expect(prepared?.html).not.toContain("<button");
  });

  it("boxes the embed and carries its content through to the PDF walker", async () => {
    await renderEmbedded("![[Note]]", "## Recipes\n\nPASTA_STEP", "PASTA_STEP");
    const prepared = await prepareContent({ entries: [], includeToc: false });
    const content = convertHtmlToPdf(prepared?.html ?? "");
    // The embed renders as a bordered box (a bordered pdfmake table), not flat text.
    const box = content.find(
      (c) => typeof c === "object" && c !== null && "table" in c && "layout" in c,
    );
    expect(box).toBeTruthy();
    const json = JSON.stringify(content);
    expect(json).toContain("Recipes");
    expect(json).toContain("PASTA_STEP");
  });

  it("exports only the requested heading section of an embed", async () => {
    await renderEmbedded("![[Note#Two]]", "## One\n\nfirst\n\n## Two\n\nsecond", "second");
    // The slice happens at render time; export must reflect what the view shows.
    const prepared = await prepareContent({ entries: [], includeToc: false });
    expect(prepared?.html).toContain("second");
    expect(prepared?.html).not.toContain("first");
  });
});
