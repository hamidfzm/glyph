import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TocEntry } from "../../hooks/useTableOfContents";
import { Sidebar } from "./Sidebar";

const mockEntries: TocEntry[] = [
  { id: "intro", text: "Introduction", level: 1 },
  { id: "getting-started", text: "Getting Started", level: 2 },
  { id: "installation", text: "Installation", level: 3 },
];

describe("Sidebar", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(<Sidebar entries={mockEntries} visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when entries are empty", () => {
    const { container } = render(<Sidebar entries={[]} visible={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Contents heading", () => {
    render(<Sidebar entries={mockEntries} visible={true} />);
    expect(screen.getByText("Contents")).toBeInTheDocument();
  });

  it("renders all entry labels", () => {
    render(<Sidebar entries={mockEntries} visible={true} />);
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Getting Started")).toBeInTheDocument();
    expect(screen.getByText("Installation")).toBeInTheDocument();
  });

  it("uses custom width when provided", () => {
    const { container } = render(<Sidebar entries={mockEntries} visible={true} width={300} />);
    const nav = container.querySelector("nav");
    expect(nav?.style.width).toBe("300px");
  });

  it("uses default width of 224 when not provided", () => {
    const { container } = render(<Sidebar entries={mockEntries} visible={true} />);
    const nav = container.querySelector("nav");
    expect(nav?.style.width).toBe("224px");
  });

  it("calls scrollIntoView when entry is clicked", () => {
    const scrollMock = vi.fn();
    const mockEl = document.createElement("div");
    mockEl.id = "intro";
    mockEl.scrollIntoView = scrollMock;
    document.body.appendChild(mockEl);

    render(<Sidebar entries={mockEntries} visible={true} />);
    fireEvent.click(screen.getByText("Introduction"));

    expect(scrollMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    document.body.removeChild(mockEl);
  });

  it("applies indentation based on heading level", () => {
    render(<Sidebar entries={mockEntries} visible={true} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].style.paddingLeft).toBe("8px");
    expect(buttons[1].style.paddingLeft).toBe("20px");
    expect(buttons[2].style.paddingLeft).toBe("32px");
  });
});
