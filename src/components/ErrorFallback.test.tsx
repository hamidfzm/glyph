import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorFallback } from "./ErrorFallback";

const { show, setFocus } = vi.hoisted(() => ({
  show: vi.fn(() => Promise.resolve()),
  setFocus: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ show, setFocus }),
}));

describe("ErrorFallback", () => {
  it("renders the recovery message", () => {
    render(<ErrorFallback />);
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it("reveals the window so the message is not hidden on an early crash", async () => {
    render(<ErrorFallback />);
    await waitFor(() => expect(show).toHaveBeenCalled());
    await waitFor(() => expect(setFocus).toHaveBeenCalled());
  });
});
