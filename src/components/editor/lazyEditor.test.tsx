import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHUNK_LOAD_TIMEOUT_MS } from "@/test/chunkLoadTimeout";
import { MarkdownEditor, SplitView } from "./lazyEditor";

// The underlying components are mocked: MarkdownEditor boots a full CodeMirror
// instance, which is irrelevant here. These tests only exercise the lazy() +
// Suspense wrappers, i.e. that the dynamic chunk resolves and props flow through.
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ content }: { content: string }) => (
    <div data-testid="markdown-editor">{content}</div>
  ),
}));

vi.mock("./SplitView", () => ({
  SplitView: ({ content }: { content: string }) => <div data-testid="split-view">{content}</div>,
}));

describe("lazyEditor", { timeout: CHUNK_LOAD_TIMEOUT_MS }, () => {
  it("lazily renders the MarkdownEditor", async () => {
    render(<MarkdownEditor content="editor body" onChange={() => {}} />);
    await waitFor(
      () => expect(screen.getByTestId("markdown-editor")).toHaveTextContent("editor body"),
      {
        timeout: CHUNK_LOAD_TIMEOUT_MS,
      },
    );
  });

  it("lazily renders the SplitView", async () => {
    render(
      <SplitView
        content="split body"
        onChange={() => {}}
        searchOpen={false}
        onSearchClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("split-view")).toHaveTextContent("split body"), {
      timeout: CHUNK_LOAD_TIMEOUT_MS,
    });
  });
});
