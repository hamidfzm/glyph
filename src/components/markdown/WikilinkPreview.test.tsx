import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedContext, type EmbedContextValue } from "@/contexts/EmbedContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { readNoteCached } from "@/lib/noteContentCache";
import { WikilinkPreview } from "./WikilinkPreview";

// Stub the nested renderer so these tests exercise WikilinkPreview's own logic
// (load, slice, placeholders, dismissal) without the full markdown provider tree.
vi.mock("./MarkdownContent", () => ({
  MarkdownContent: ({ content, filePath }: { content: string; filePath?: string }) => (
    <div data-testid="nested" data-filepath={filePath}>
      {content}
    </div>
  ),
}));

vi.mock("@/lib/noteContentCache", () => ({ readNoteCached: vi.fn() }));

type PreviewProps = React.ComponentProps<typeof WikilinkPreview>;

const defaultProps: PreviewProps = {
  anchor: document.createElement("a"),
  target: "Note",
  path: "/w/Note.md",
  onOpen: vi.fn(),
  onKeepOpen: vi.fn(),
  onClose: vi.fn(),
};

const tabsApi = {
  createNote: vi.fn(),
  renamePath: vi.fn(),
  openFile: vi.fn(),
};

function renderPreview(props: Partial<PreviewProps> = {}, workspaceFiles = ["/w/Note.md"]) {
  const embed: EmbedContextValue = { chain: [], workspaceFiles };
  const tabs = { workspace: { root: "/w" }, ...tabsApi } as unknown as TabsContextValue;
  const ui: ReactNode = (
    <TabsContext.Provider value={tabs}>
      <EmbedContext.Provider value={embed}>
        <WikilinkPreview {...defaultProps} {...props} />
      </EmbedContext.Provider>
    </TabsContext.Provider>
  );
  return render(ui);
}

describe("WikilinkPreview", () => {
  beforeEach(() => {
    vi.mocked(readNoteCached).mockReset();
    for (const fn of Object.values(tabsApi)) fn.mockReset();
  });

  it("renders the target note once loaded", async () => {
    vi.mocked(readNoteCached).mockResolvedValueOnce("# Note\nbody text");
    renderPreview();

    const nested = await screen.findByTestId("nested");
    expect(nested).toHaveTextContent("body text");
    expect(nested).toHaveAttribute("data-filepath", "/w/Note.md");
  });

  it("previews only the linked section", async () => {
    vi.mocked(readNoteCached).mockResolvedValueOnce("## A\nalpha\n## B\nbeta");
    renderPreview({ heading: "B" });

    const nested = await screen.findByTestId("nested");
    expect(nested).toHaveTextContent("beta");
    expect(nested).not.toHaveTextContent("alpha");
  });

  it("reports a missing heading", async () => {
    vi.mocked(readNoteCached).mockResolvedValueOnce("## A\nalpha");
    renderPreview({ heading: "Nope" });

    expect(await screen.findByText(/Heading not found/)).toBeInTheDocument();
    expect(screen.queryByTestId("nested")).not.toBeInTheDocument();
  });

  it("reports a failed read", async () => {
    vi.mocked(readNoteCached).mockRejectedValueOnce(new Error("denied"));
    renderPreview();

    expect(await screen.findByText(/Could not load preview/)).toBeInTheDocument();
  });

  it("ignores a read that settles after unmount", async () => {
    let resolve: ((v: string) => void) | undefined;
    vi.mocked(readNoteCached).mockReturnValueOnce(
      new Promise<string>((r) => {
        resolve = r;
      }),
    );
    const { unmount } = renderPreview();
    unmount();
    resolve?.("late body");
    await Promise.resolve();
    expect(screen.queryByTestId("nested")).not.toBeInTheDocument();
  });

  it("refuses to read a path outside the workspace (raw-HTML injection guard)", () => {
    renderPreview({ path: "/etc/passwd", target: "passwd" });

    expect(screen.getByText(/Note not found: passwd/)).toBeInTheDocument();
    expect(readNoteCached).not.toHaveBeenCalled();
  });

  it("creates and opens the missing note from a broken link", async () => {
    tabsApi.createNote.mockResolvedValue("/w/Untitled.md");
    tabsApi.renamePath.mockResolvedValue("/w/Missing.md");
    renderPreview({ path: undefined, target: "Missing" });

    fireEvent.click(screen.getByRole("button", { name: /create note/i }));
    await vi.waitFor(() => expect(tabsApi.openFile).toHaveBeenCalledWith("/w/Missing.md"));
    expect(tabsApi.createNote).toHaveBeenCalledWith("/w");
    expect(tabsApi.renamePath).toHaveBeenCalledWith("/w/Untitled.md", "Missing");
  });

  it("offers no create affordance for a nested target", () => {
    renderPreview({ path: undefined, target: "folder/Missing" });

    expect(screen.getByText(/Note not found/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create note/i })).not.toBeInTheDocument();
  });

  it("opens the note when the popover is clicked, but not when it is broken", async () => {
    vi.mocked(readNoteCached).mockResolvedValueOnce("body");
    const onOpen = vi.fn();
    const { unmount } = renderPreview({ onOpen });

    fireEvent.click(await screen.findByRole("dialog"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    unmount();

    const brokenOnOpen = vi.fn();
    renderPreview({ path: undefined, target: "Missing", onOpen: brokenOnOpen });
    fireEvent.click(screen.getByRole("dialog"));
    expect(brokenOnOpen).not.toHaveBeenCalled();
  });

  it("dismisses on Escape, on an outside press, and when the pointer leaves", async () => {
    vi.mocked(readNoteCached).mockResolvedValue("body");
    const onClose = vi.fn();
    renderPreview({ onClose });

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    fireEvent.mouseLeave(await screen.findByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
