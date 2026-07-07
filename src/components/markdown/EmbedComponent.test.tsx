import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedContext, type EmbedContextValue } from "@/contexts/EmbedContext";
import { EmbedComponent } from "./EmbedComponent";

// Stub the nested renderer so these tests exercise EmbedComponent's own logic
// (load, slice, placeholders) without pulling the full markdown provider tree.
vi.mock("./MarkdownContent", () => ({
  MarkdownContent: ({ content, filePath }: { content: string; filePath?: string }) => (
    <div data-testid="nested" data-filepath={filePath}>
      {content}
    </div>
  ),
}));

function renderEmbed(props: Record<string, unknown>, ctx: Partial<EmbedContextValue> = {}) {
  // Default the target into the workspace so the workspace-membership gate
  // passes; tests that exercise the gate override workspaceFiles.
  const value: EmbedContextValue = { chain: [], workspaceFiles: ["/w/Note.md"], ...ctx };
  return render(
    <EmbedContext.Provider value={value}>
      <EmbedComponent {...props} />
    </EmbedContext.Provider>,
  );
}

describe("EmbedComponent", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("renders the target note inline once loaded", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("# Note\nbody text");
    renderEmbed({ "data-embed-path": "/w/Note.md", "data-embed-target": "Note" });

    const nested = await screen.findByTestId("nested");
    expect(nested).toHaveTextContent("body text");
    expect(nested).toHaveAttribute("data-filepath", "/w/Note.md");
  });

  it("slices to the requested heading section", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("## A\nalpha\n## B\nbeta");
    renderEmbed({
      "data-embed-path": "/w/Note.md",
      "data-embed-target": "Note",
      "data-embed-heading": "B",
    });

    const nested = await screen.findByTestId("nested");
    expect(nested).toHaveTextContent("beta");
    expect(nested).not.toHaveTextContent("alpha");
  });

  it("shows a placeholder when the heading is missing", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("## A\nalpha");
    renderEmbed({
      "data-embed-path": "/w/Note.md",
      "data-embed-target": "Note",
      "data-embed-heading": "Nope",
    });

    expect(await screen.findByText(/Heading not found/)).toBeInTheDocument();
    expect(screen.queryByTestId("nested")).not.toBeInTheDocument();
  });

  it("renders a broken placeholder without a resolved path", () => {
    renderEmbed({ "data-embed-target": "Missing", "data-embed-broken": "" });
    expect(screen.getByText(/Embedded note not found: Missing/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses to read a path outside the workspace (raw-HTML injection guard)", () => {
    renderEmbed(
      { "data-embed-path": "/etc/passwd", "data-embed-target": "passwd" },
      { workspaceFiles: ["/w/Note.md"] },
    );
    expect(screen.getByText(/Embedded note not found: passwd/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows an error placeholder when the read fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("denied"));
    renderEmbed({ "data-embed-path": "/w/Note.md", "data-embed-target": "Note" });
    expect(await screen.findByText(/Could not load embed/)).toBeInTheDocument();
    expect(screen.queryByTestId("nested")).not.toBeInTheDocument();
  });

  it("renders a circular placeholder when the target is already in the chain", () => {
    renderEmbed(
      { "data-embed-path": "/w/Note.md", "data-embed-target": "Note" },
      { chain: ["/w/Note.md"] },
    );
    expect(screen.getByText(/Circular embed: Note/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("navigates to the source when the open control is clicked", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("body");
    const onOpenWikilink = vi.fn();
    renderEmbed(
      { "data-embed-path": "/w/Note.md", "data-embed-target": "Note", "data-embed-heading": "H" },
      { onOpenWikilink },
    );

    const button = await screen.findByRole("button", { name: /open embedded note/i });
    fireEvent.click(button);
    expect(onOpenWikilink).toHaveBeenCalledWith("/w/Note.md", "H");
  });
});
