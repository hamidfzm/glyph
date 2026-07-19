import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";
import type { ChatTurn } from "@/hooks/useAIChat";
import { DEFAULT_SETTINGS } from "@/lib/settings";
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

  it("commits the dragged width to settings on release", () => {
    const updateSettings = vi.fn();
    render(
      <SettingsContext.Provider
        value={{
          settings: DEFAULT_SETTINGS,
          updateSettings,
          resetSettings: noop,
          flushSettings: async () => true,
          loaded: true,
        }}
      >
        <AIChatPanel {...defaultProps} />
      </SettingsContext.Provider>,
    );
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { button: 0, clientX: 500 });
    // Docked at the inline-end edge in LTR: dragging left widens the panel.
    fireEvent.pointerMove(handle, { clientX: 450 });
    fireEvent.pointerUp(handle);
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith(
      "layout.aiPanelWidth",
      DEFAULT_SETTINGS.layout.aiPanelWidth + 50,
    );
  });

  it("inverts the resize drag direction under RTL", () => {
    document.documentElement.dir = "rtl";
    try {
      const updateSettings = vi.fn();
      render(
        <SettingsContext.Provider
          value={{
            settings: DEFAULT_SETTINGS,
            updateSettings,
            resetSettings: noop,
            flushSettings: async () => true,
            loaded: true,
          }}
        >
          <AIChatPanel {...defaultProps} />
        </SettingsContext.Provider>,
      );
      const handle = screen.getByRole("separator");
      fireEvent.pointerDown(handle, { button: 0, clientX: 500 });
      // Mirrored dock: dragging right widens the panel.
      fireEvent.pointerMove(handle, { clientX: 550 });
      fireEvent.pointerUp(handle);
      expect(updateSettings).toHaveBeenCalledExactlyOnceWith(
        "layout.aiPanelWidth",
        DEFAULT_SETTINGS.layout.aiPanelWidth + 50,
      );
    } finally {
      document.documentElement.dir = "";
    }
  });

  it("double-click on the handle resets the width to its default", () => {
    const updateSettings = vi.fn();
    render(
      <SettingsContext.Provider
        value={{
          settings: DEFAULT_SETTINGS,
          updateSettings,
          resetSettings: noop,
          flushSettings: async () => true,
          loaded: true,
        }}
      >
        <AIChatPanel {...defaultProps} />
      </SettingsContext.Provider>,
    );
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith(
      "layout.aiPanelWidth",
      DEFAULT_SETTINGS.layout.aiPanelWidth,
    );
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

  it("does not send blank input or while the composer is disabled", () => {
    const onSend = vi.fn();
    const { rerender } = render(<AIChatPanel {...defaultProps} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/ask about this document/i);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    rerender(<AIChatPanel {...defaultProps} onSend={onSend} configured={false} />);
    expect(screen.getByPlaceholderText(/ask about this document/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("stops following the stream when the user scrolls up, resumes at the bottom", () => {
    const { container, rerender } = render(<AIChatPanel {...defaultProps} turns={conversation} />);
    const body = container.querySelector(".ai-chat-body") as HTMLDivElement;
    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(body, "clientHeight", { configurable: true, value: 200 });

    // Scrolled far from the bottom: appending a turn must not yank the view.
    body.scrollTop = 100;
    fireEvent.scroll(body);
    rerender(
      <AIChatPanel
        {...defaultProps}
        turns={[...conversation, { id: 3, role: "assistant", content: "more" }]}
      />,
    );
    expect(body.scrollTop).toBe(100);

    // Back near the bottom: the next update pins to the end again.
    body.scrollTop = 790;
    fireEvent.scroll(body);
    rerender(
      <AIChatPanel
        {...defaultProps}
        turns={[...conversation, { id: 3, role: "assistant", content: "more text" }]}
      />,
    );
    expect(body.scrollTop).toBe(1000);
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
