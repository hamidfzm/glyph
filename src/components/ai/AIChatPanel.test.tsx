import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "@/hooks/useAIChat";
import { AIChatPanel } from "./AIChatPanel";

const noop = () => {};

const defaultProps = {
  open: true,
  onClose: noop,
  turns: [] as ChatTurn[],
  streaming: false,
  error: null as string | null,
  configured: true,
  hasDocument: true,
  onSend: noop,
  onStop: noop,
  onClear: noop,
  onQuickAction: noop,
};

const conversation: ChatTurn[] = [
  { id: 1, role: "user", content: "long prompt", display: "Summarize the document" },
  { id: 2, role: "assistant", content: "# Summary\n\nDone." },
];

describe("AIChatPanel", () => {
  it("renders closed via data-open=false", () => {
    const { container } = render(<AIChatPanel {...defaultProps} open={false} />);
    expect(container.querySelector('.ai-chat-panel[data-open="false"]')).not.toBeNull();
  });

  it("shows the empty hint when there is no conversation", () => {
    render(<AIChatPanel {...defaultProps} />);
    expect(screen.getByText(/quick action/i)).toBeInTheDocument();
  });

  it("renders user turns by display label and assistant turns as markdown", () => {
    render(<AIChatPanel {...defaultProps} turns={conversation} />);
    expect(screen.getByText("Summarize the document")).toBeInTheDocument();
    expect(screen.queryByText("long prompt")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
  });

  it("sends the composer text on Enter and clears the input", () => {
    const onSend = vi.fn();
    render(<AIChatPanel {...defaultProps} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/ask about this document/i);
    fireEvent.change(input, { target: { value: "what is this?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("what is this?");
    expect(input).toHaveValue("");
  });

  it("does not send on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<AIChatPanel {...defaultProps} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/ask about this document/i);
    fireEvent.change(input, { target: { value: "line" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a stop button while streaming and a typing indicator before the first token", () => {
    const onStop = vi.fn();
    const pending: ChatTurn[] = [
      { id: 1, role: "user", content: "hi" },
      { id: 2, role: "assistant", content: "" },
    ];
    render(<AIChatPanel {...defaultProps} turns={pending} streaming={true} onStop={onStop} />);
    expect(screen.getByLabelText("Thinking…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("runs quick actions from the chips", () => {
    const onQuickAction = vi.fn();
    render(<AIChatPanel {...defaultProps} onQuickAction={onQuickAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    expect(onQuickAction).toHaveBeenCalledWith("summarize");
  });

  it("hides the chips when no document is open", () => {
    render(<AIChatPanel {...defaultProps} hasDocument={false} />);
    expect(screen.queryByRole("button", { name: "Summarize" })).not.toBeInTheDocument();
  });

  it("offers Clear only when there is a conversation", () => {
    const onClear = vi.fn();
    const { rerender } = render(<AIChatPanel {...defaultProps} onClear={onClear} />);
    expect(screen.queryByRole("button", { name: "Clear conversation" })).not.toBeInTheDocument();

    rerender(<AIChatPanel {...defaultProps} onClear={onClear} turns={conversation} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("shows errors and the not-configured notice", () => {
    render(<AIChatPanel {...defaultProps} error="Ollama error (500)" />);
    expect(screen.getByText("Ollama error (500)")).toBeInTheDocument();

    render(<AIChatPanel {...defaultProps} configured={false} />);
    expect(screen.getByText(/no ai provider configured/i)).toBeInTheDocument();
  });

  it("copies an assistant reply", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<AIChatPanel {...defaultProps} turns={conversation} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("# Summary\n\nDone.");
    vi.unstubAllGlobals();
  });

  it("offers read-aloud on assistant replies when TTS is available", () => {
    const onReadAloud = vi.fn();
    render(<AIChatPanel {...defaultProps} turns={conversation} onReadAloud={onReadAloud} />);
    fireEvent.click(screen.getByRole("button", { name: "Read Aloud" }));
    expect(onReadAloud).toHaveBeenCalledWith("# Summary\n\nDone.");
  });
});
