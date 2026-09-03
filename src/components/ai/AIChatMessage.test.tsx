import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("opens reply links externally, behind the prompt, instead of navigating the webview", async () => {
    // The open document rides in the system prompt, so a document can steer
    // the model into emitting a link; a plain anchor would navigate the app.
    render(
      <AIChatMessage
        turn={{ id: 1, role: "assistant", content: "See [docs](https://example.com/guide)." }}
      />,
    );
    const link = screen.getByRole("link", { name: /docs/ });
    const click = createEvent.click(link);
    fireEvent(link, click);

    expect(click.defaultPrevented).toBe(true);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com/guide"));
    expect(ask).toHaveBeenCalled();
  });

  it("swallows a link whose scheme the markdown sanitizer emptied", () => {
    // react-markdown renders javascript: hrefs as href="", and following that
    // would reload the app (and drop unsaved edits) rather than run script.
    vi.mocked(openUrl).mockClear();
    render(
      <AIChatMessage
        turn={{ id: 1, role: "assistant", content: "Click [here](javascript:alert(1))." }}
      />,
    );
    // An emptied href does not register as a link role, so query by text.
    const link = screen.getByText("here");
    expect(link.tagName).toBe("A");
    const click = createEvent.click(link);
    fireEvent(link, click);

    expect(click.defaultPrevented).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();
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
