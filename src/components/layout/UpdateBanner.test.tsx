import { openUrl } from "@tauri-apps/plugin-opener";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";

const UPDATE = {
  latestVersion: "0.9.0",
  currentVersion: "0.8.1",
  url: "https://example.com/0.9.0",
};

describe("UpdateBanner", () => {
  it("renders nothing when there is no update", () => {
    const { container } = render(<UpdateBanner update={null} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the available and current versions", () => {
    render(<UpdateBanner update={UPDATE} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Glyph 0\.9\.0 is available/)).toBeInTheDocument();
    expect(screen.getByText(/you have 0\.8\.1/)).toBeInTheDocument();
  });

  it("opens the release URL when Download is clicked", async () => {
    render(<UpdateBanner update={UPDATE} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/0.9.0");
  });

  it("calls onDismiss when the close button is clicked", async () => {
    const onDismiss = vi.fn();
    render(<UpdateBanner update={UPDATE} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss update notification" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
