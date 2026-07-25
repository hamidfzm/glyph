import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorReportingBanner } from "./ErrorReportingBanner";

const defaultProps = { onEnable: vi.fn(), onDecline: vi.fn() };

describe("ErrorReportingBanner", () => {
  it("asks about crash reports", () => {
    render(<ErrorReportingBanner {...defaultProps} />);
    expect(screen.getByText(/crash reports/)).toBeInTheDocument();
  });

  it("calls onEnable when Enable is clicked", async () => {
    const onEnable = vi.fn();
    render(<ErrorReportingBanner {...defaultProps} onEnable={onEnable} />);
    await userEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("calls onDecline from both 'No thanks' and the close button", async () => {
    const onDecline = vi.fn();
    render(<ErrorReportingBanner {...defaultProps} onDecline={onDecline} />);
    await userEvent.click(screen.getByRole("button", { name: "No thanks" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss crash-reporting prompt" }));
    expect(onDecline).toHaveBeenCalledTimes(2);
  });
});
