import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatComposer } from "./AIChatComposer";

const defaultProps = {
  streaming: false,
  placeholder: "Ask…",
  onSend: vi.fn(),
  onStop: vi.fn(),
};

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Ask…") as HTMLTextAreaElement;
}

describe("AIChatComposer", () => {
  it("keeps the scrollbar hidden while the input fits, shows it past max height", () => {
    render(<AIChatComposer {...defaultProps} />);
    const el = textarea();

    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 40 });
    fireEvent.change(el, { target: { value: "one line" } });
    expect(el.style.overflowY).toBe("hidden");
    expect(el.style.height).toBe("40px");

    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 400 });
    fireEvent.change(el, { target: { value: "many\nlines\nof\ntext" } });
    expect(el.style.overflowY).toBe("auto");
    expect(el.style.height).toBe("120px");
  });

  it("resets height and scrollbar after sending", () => {
    const onSend = vi.fn();
    render(<AIChatComposer {...defaultProps} onSend={onSend} />);
    const el = textarea();

    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 400 });
    fireEvent.change(el, { target: { value: "long message" } });
    fireEvent.keyDown(el, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("long message");
    expect(el.style.height).toBe("auto");
    expect(el.style.overflowY).toBe("hidden");
  });
});
