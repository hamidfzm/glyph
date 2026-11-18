import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHUNK_LOAD_TIMEOUT_MS } from "@/test/chunkLoadTimeout";
import { AIChatPanel } from "./lazyAIChatPanel";

// The underlying panel pulls in the whole AI feature; these tests only
// exercise the first-open latch and the lazy() + Suspense plumbing.
vi.mock("./AIChatPanel", () => ({
  AIChatPanel: ({ open }: { open: boolean }) => (
    <div data-testid="ai-chat-panel">{open ? "open" : "closed"}</div>
  ),
}));

const defaultProps = {
  onClose: vi.fn(),
  turns: [],
  streaming: false,
  error: null,
  configured: true,
  hasDocument: false,
  onSend: vi.fn(),
  onStop: vi.fn(),
  onClear: vi.fn(),
  onQuickAction: vi.fn(),
};

describe("lazyAIChatPanel", { timeout: CHUNK_LOAD_TIMEOUT_MS }, () => {
  it("renders nothing while the panel has never been opened", () => {
    render(<AIChatPanel {...defaultProps} open={false} />);
    expect(screen.queryByTestId("ai-chat-panel")).not.toBeInTheDocument();
  });

  it("loads the panel on first open", async () => {
    render(<AIChatPanel {...defaultProps} open />);
    await waitFor(() => expect(screen.getByTestId("ai-chat-panel")).toHaveTextContent("open"), {
      timeout: CHUNK_LOAD_TIMEOUT_MS,
    });
  });

  it("keeps the panel mounted after it closes so composer draft and scroll survive", async () => {
    const { rerender } = render(<AIChatPanel {...defaultProps} open />);
    await waitFor(() => expect(screen.getByTestId("ai-chat-panel")).toBeInTheDocument(), {
      timeout: CHUNK_LOAD_TIMEOUT_MS,
    });
    rerender(<AIChatPanel {...defaultProps} open={false} />);
    expect(screen.getByTestId("ai-chat-panel")).toHaveTextContent("closed");
  });
});
