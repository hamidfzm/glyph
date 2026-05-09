import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileTab, FolderTab, Tab } from "@/hooks/useTabs";
import { TabBar } from "./TabBar";

const makeFileTab = (i: number): FileTab => ({
  id: `tab-${i}`,
  kind: "file",
  file: {
    path: `/path/to/file${i}.md`,
    content: `# File ${i}`,
    metadata: { name: `file${i}.md`, path: `/path/to/file${i}.md`, size: 100, modified: 0 },
    scrollTop: 0,
    mode: "view",
    editContent: null,
    dirty: false,
  },
});

const makeFolderTab = (i: number, root: string): FolderTab => ({
  id: `tab-${i}`,
  kind: "folder",
  root,
  expanded: new Set(),
  nodes: new Map(),
  file: null,
});

const makeTabs = (count: number): Tab[] => Array.from({ length: count }, (_, i) => makeFileTab(i));

describe("TabBar", () => {
  it("renders nothing when no tabs", () => {
    const { container } = render(
      <TabBar tabs={[]} activeTabId={null} onActivate={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders tab items with file names", () => {
    const tabs = makeTabs(3);
    render(<TabBar tabs={tabs} activeTabId="tab-0" onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("file0.md")).toBeInTheDocument();
    expect(screen.getByText("file1.md")).toBeInTheDocument();
    expect(screen.getByText("file2.md")).toBeInTheDocument();
  });

  it("highlights the active tab", () => {
    const tabs = makeTabs(2);
    render(<TabBar tabs={tabs} activeTabId="tab-1" onActivate={vi.fn()} onClose={vi.fn()} />);
    const activeTab = screen.getByText("file1.md").closest(".tab-item");
    expect(activeTab?.getAttribute("data-active")).toBe("true");
  });

  it("calls onActivate when clicking a tab", () => {
    const onActivate = vi.fn();
    const tabs = makeTabs(2);
    render(<TabBar tabs={tabs} activeTabId="tab-0" onActivate={onActivate} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("file1.md"));
    expect(onActivate).toHaveBeenCalledWith("tab-1");
  });

  it("calls onClose when clicking close button", () => {
    const onClose = vi.fn();
    const tabs = makeTabs(1);
    render(<TabBar tabs={tabs} activeTabId="tab-0" onActivate={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close file0.md" }));
    expect(onClose).toHaveBeenCalledWith("tab-0");
  });

  it("calls onClose on middle-click", () => {
    const onClose = vi.fn();
    const tabs = makeTabs(1);
    render(<TabBar tabs={tabs} activeTabId="tab-0" onActivate={vi.fn()} onClose={onClose} />);
    const tabEl = screen.getByText("file0.md").closest(".tab-item")!;
    fireEvent(tabEl, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenCalledWith("tab-0");
  });

  it("renders folder tabs with the folder basename and folder kind marker", () => {
    const tabs: Tab[] = [makeFolderTab(0, "/Users/me/notes")];
    render(<TabBar tabs={tabs} activeTabId="tab-0" onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("notes")).toBeInTheDocument();
    const tabEl = screen.getByText("notes").closest(".tab-item");
    expect(tabEl?.getAttribute("data-tab-kind")).toBe("folder");
  });

  it("hides mode toggle when active tab is a folder with no current file", () => {
    const tabs: Tab[] = [makeFolderTab(0, "/Users/me/notes")];
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-0"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("View mode")).not.toBeInTheDocument();
  });
});
