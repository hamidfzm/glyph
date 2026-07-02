import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatMessage } from "./AIChatMessage";

vi.mock("@/lib/documentHighlight", () => ({ locateInDocument: vi.fn().mockReturnValue(true) }));

describe("AIChatMessage", () => {
  it("renders a user turn's raw content when it has no display label", () => {
    render(<AIChatMessage turn={{ id: 1, role: "user", content: "typed text" }} />);
    expect(screen.getByText("typed text")).toBeInTheDocument();
  });

  it("renders blockquotes in assistant turns with a locate button", () => {
    render(
      <AIChatMessage turn={{ id: 1, role: "assistant", content: "Intro\n\n> quoted line" }} />,
    );
    expect(screen.getByText("quoted line")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show in document" })).toBeInTheDocument();
  });

  it("shows Stop Reading while speaking and invokes onStopReading", () => {
    const onStopReading = vi.fn();
    render(
      <AIChatMessage
        turn={{ id: 1, role: "assistant", content: "reply" }}
        onReadAloud={vi.fn()}
        speaking={true}
        onStopReading={onStopReading}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop Reading" }));
    expect(onStopReading).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Read Aloud" })).not.toBeInTheDocument();
  });

  it("omits the read-aloud button entirely when TTS is unavailable", () => {
    render(<AIChatMessage turn={{ id: 1, role: "assistant", content: "reply" }} />);
    expect(screen.queryByRole("button", { name: "Read Aloud" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
