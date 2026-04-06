import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIPanel } from "./AIPanel";

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  loading: false,
  result: null,
  error: null,
  action: null,
};

describe("AIPanel", () => {
  it("renders with data-open attribute", () => {
    const { container } = render(<AIPanel {...defaultProps} />);
    const panel = container.querySelector(".ai-panel");
    expect(panel?.getAttribute("data-open")).toBe("true");
  });

  it("shows empty state message when no action is running", () => {
    render(<AIPanel {...defaultProps} />);
    expect(screen.getByText(/Use the AI menu/)).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<AIPanel {...defaultProps} loading={true} action="summarize" />);
    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("shows error message", () => {
    render(<AIPanel {...defaultProps} error="Something went wrong" action="summarize" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows action label in header", () => {
    render(<AIPanel {...defaultProps} action="summarize" />);
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  it("shows AI as header when no action", () => {
    render(<AIPanel {...defaultProps} />);
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<AIPanel {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows Copy button when result is available", () => {
    render(<AIPanel {...defaultProps} result="Some result" action="summarize" />);
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("shows Read Aloud button when onReadAloud is provided", () => {
    render(
      <AIPanel {...defaultProps} result="Some result" action="summarize" onReadAloud={vi.fn()} />,
    );
    expect(screen.getByText("Read Aloud")).toBeInTheDocument();
  });

  it("shows Stop Reading button when speaking", () => {
    render(
      <AIPanel
        {...defaultProps}
        result="text"
        action="summarize"
        onReadAloud={vi.fn()}
        speaking={true}
        onStopReading={vi.fn()}
      />,
    );
    expect(screen.getByText("Stop Reading")).toBeInTheDocument();
  });

  it("displays correct labels for each action", () => {
    const actions = [
      { action: "summarize" as const, label: "Summary" },
      { action: "explain" as const, label: "Explanation" },
      { action: "translate" as const, label: "Translation" },
      { action: "simplify" as const, label: "Simplified" },
    ];

    for (const { action, label } of actions) {
      const { unmount } = render(<AIPanel {...defaultProps} action={action} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});
