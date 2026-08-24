import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "@/components/modals/SearchPanel";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { DEFAULT_SEARCH_OPTIONS, EMPTY_SEARCH_RESULTS } from "@/lib/workspaceSearch";

const locateWhenRendered = vi.hoisted(() =>
  vi.fn((_locate: () => boolean, _onFail?: () => void) => vi.fn()),
);
const locateLineInDocument = vi.hoisted(() => vi.fn());
vi.mock("@/lib/documentHighlight", () => ({ locateWhenRendered, locateLineInDocument }));

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
  beforeEach(() => {
    locateWhenRendered.mockClear();
    locateLineInDocument.mockClear();
  });

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

  it("opens the file and locates the match's line without closing", async () => {
    const openFile = vi.fn();
    const onClose = vi.fn();
    renderPanel({ results: hit, onClose }, openFile);

    await userEvent.click(screen.getByText("is here", { exact: false }));

    expect(openFile).toHaveBeenCalledWith("/ws/notes/daily.md");
    expect(locateWhenRendered).toHaveBeenCalled();
    locateWhenRendered.mock.calls[0][0]();
    expect(locateLineInDocument).toHaveBeenCalledWith(4, "needle");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("steps hits with the arrow keys and opens the selection on Enter", async () => {
    const openFile = vi.fn();
    renderPanel({ results: hit }, openFile);

    const rows = document.querySelectorAll(".workspace-search-row");
    expect(rows[0].getAttribute("data-selected")).toBe("true");

    await userEvent.keyboard("{ArrowDown}");
    expect(rows[1].getAttribute("data-selected")).toBe("true");
    expect(rows[0].getAttribute("data-selected")).toBeNull();

    await userEvent.keyboard("{Enter}");
    expect(openFile).toHaveBeenCalledWith("/ws/notes/daily.md");
    locateWhenRendered.mock.calls.at(-1)?.[0]();
    expect(locateLineInDocument).toHaveBeenCalledWith(9, "needle");
  });

  it("clamps the selection at both ends", async () => {
    renderPanel({ results: hit });

    await userEvent.keyboard("{ArrowUp}");
    expect(
      document.querySelectorAll(".workspace-search-row")[0].getAttribute("data-selected"),
    ).toBe("true");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(
      document.querySelectorAll(".workspace-search-row")[1].getAttribute("data-selected"),
    ).toBe("true");
  });

  it("ignores Enter with no hits", async () => {
    const openFile = vi.fn();
    renderPanel({}, openFile);

    await userEvent.keyboard("{Enter}");
    expect(openFile).not.toHaveBeenCalled();
  });

  it("cancels a pending jump when a newer hit is clicked", async () => {
    const cancel = vi.fn();
    locateWhenRendered.mockReturnValueOnce(cancel);
    renderPanel({ results: hit });

    const rows = screen.getAllByText("needle");
    await userEvent.click(rows[0]);
    await userEvent.click(rows[1]);

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("says when the jump could not land", async () => {
    renderPanel({ results: hit });

    await userEvent.click(screen.getByText("is here", { exact: false }));
    const [, onFail] = locateWhenRendered.mock.calls[0];
    act(() => onFail?.());

    expect(screen.getByText(/couldn't scroll/)).toBeInTheDocument();
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
