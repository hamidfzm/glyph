import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchPanel } from "@/components/modals/SearchPanel";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { DEFAULT_SEARCH_OPTIONS, EMPTY_SEARCH_RESULTS } from "@/lib/workspaceSearch";

const locate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/documentHighlight", () => ({ locateWhenRendered: locate }));

const defaultProps = {
  open: true,
  query: "needle",
  options: DEFAULT_SEARCH_OPTIONS,
  results: EMPTY_SEARCH_RESULTS,
  searching: false,
  failed: false,
  onQueryChange: vi.fn(),
  onToggleOption: vi.fn(),
  onClose: vi.fn(),
};

const hit = {
  files: [
    {
      path: "/ws/notes/daily.md",
      matches: [
        { line: 4, column: 4, before: "the ", text: "needle", after: " is here" },
        { line: 9, column: 9, before: "a second ", text: "needle", after: "" },
      ],
    },
  ],
  total: 2,
  truncated: false,
};

function renderPanel(props: Partial<typeof defaultProps> = {}, openFile = vi.fn()) {
  const tabs = { workspace: { root: "/ws" }, openFile } as unknown as TabsContextValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>
  );
  return render(<SearchPanel {...defaultProps} {...props} />, { wrapper });
}

describe("SearchPanel", () => {
  it("renders nothing while closed", () => {
    renderPanel({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("groups matches by file and highlights the matched fragment", () => {
    renderPanel({ results: hit });

    expect(screen.getByText("notes/daily.md")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("is here", { exact: false })).toBeInTheDocument();
    const marks = document.querySelectorAll("mark.workspace-search-mark");
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe("needle");
  });

  it("opens the file and scrolls the match into view", async () => {
    const openFile = vi.fn();
    const onClose = vi.fn();
    renderPanel({ results: hit, onClose }, openFile);

    await userEvent.click(screen.getByText("is here", { exact: false }));

    expect(openFile).toHaveBeenCalledWith("/ws/notes/daily.md");
    expect(locate).toHaveBeenCalledWith("needle");
    expect(onClose).toHaveBeenCalled();
  });

  it("toggles an option from its button", async () => {
    const onToggleOption = vi.fn();
    renderPanel({ onToggleOption });

    await userEvent.click(screen.getByRole("button", { name: "Match whole word" }));
    expect(onToggleOption).toHaveBeenCalledWith("wholeWord");
  });

  it("marks the active toggles as pressed", () => {
    renderPanel({ options: { caseSensitive: true, wholeWord: false, regex: false } });

    expect(screen.getByRole("button", { name: "Match case" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Match whole word" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("blames the pattern only when the regex toggle is on", () => {
    const { unmount } = renderPanel({ failed: true });
    expect(screen.getByText("Search failed.")).toBeInTheDocument();
    unmount();

    renderPanel({ failed: true, options: { ...DEFAULT_SEARCH_OPTIONS, regex: true } });
    expect(screen.getByText("That regular expression is not valid.")).toBeInTheDocument();
  });

  it("says when the results were capped", () => {
    renderPanel({ results: { ...hit, truncated: true } });
    expect(screen.getByText(/Narrow the search/)).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
