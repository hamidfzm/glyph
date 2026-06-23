import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadingAnchor } from "./HeadingAnchor";

const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: writeTextMock },
  configurable: true,
});

describe("HeadingAnchor", () => {
  afterEach(() => {
    writeTextMock.mockClear();
    writeTextMock.mockResolvedValue(undefined);
    vi.useRealTimers();
  });

  it("renders an accessible copy-link button", () => {
    render(<HeadingAnchor id="installation" />);
    expect(screen.getByRole("button", { name: "Copy link to heading" })).toBeTruthy();
  });

  it("copies the bare anchor for the heading id on click", async () => {
    render(<HeadingAnchor id="installation" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(writeTextMock).toHaveBeenCalledWith("#installation");
  });

  it("shows copied feedback after a successful copy, then reverts", async () => {
    vi.useFakeTimers();
    render(<HeadingAnchor id="usage" />);
    const button = screen.getByRole("button");

    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(button.classList.contains("copied")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Copy link to heading" })).toBeTruthy();
    expect(button.classList.contains("copied")).toBe(false);
  });

  it("resets the revert timer when clicked again before it fires", async () => {
    vi.useFakeTimers();
    render(<HeadingAnchor id="usage" />);
    const button = screen.getByRole("button");

    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    // Second click within the window clears the pending timer and starts a new
    // 2s window, so the button is still showing "Copied" 1s later.
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(button.classList.contains("copied")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(button.classList.contains("copied")).toBe(false);
  });

  it("ignores clipboard rejections without throwing", async () => {
    writeTextMock.mockRejectedValueOnce(new Error("denied"));
    render(<HeadingAnchor id="denied" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(writeTextMock).toHaveBeenCalledWith("#denied");
    // Stays in the idle state since the copy failed.
    expect(screen.getByRole("button", { name: "Copy link to heading" })).toBeTruthy();
  });
});
