import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Tab } from "../../hooks/useTabs";
import { TabBar } from "./TabBar";

const makeTabs = (count: number): Tab[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `tab-${i}`,
    path: `/path/to/file${i}.md`,
    content: `# File ${i}`,
    metadata: { name: `file${i}.md`, path: `/path/to/file${i}.md`, size: 100, modified: 0 },
    scrollTop: 0,
    mode: "view" as const,
    editContent: null,
    dirty: false,
  }));

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
});
