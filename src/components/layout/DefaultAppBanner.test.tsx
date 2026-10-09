import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enSettings from "@/locales/en/settings.json";
import { DefaultAppBanner } from "./DefaultAppBanner";

const defaultProps = {
  outcome: null,
  busy: false,
  onSetDefault: vi.fn(),
  onNotNow: vi.fn(),
  onNever: vi.fn(),
  onDismissOutcome: vi.fn(),
};

const DISMISS = "Dismiss default-app prompt";

describe("DefaultAppBanner", () => {
  it("asks the question and reports 'Set as default' and 'Never'", async () => {
    const onSetDefault = vi.fn();
    const onNever = vi.fn();
    render(<DefaultAppBanner {...defaultProps} onSetDefault={onSetDefault} onNever={onNever} />);

    expect(screen.getByRole("status")).toHaveTextContent("Make Glyph your default Markdown app?");
    await userEvent.click(screen.getByRole("button", { name: "Set as default" }));
    await userEvent.click(screen.getByRole("button", { name: "Never" }));
    expect(onSetDefault).toHaveBeenCalledTimes(1);
    expect(onNever).toHaveBeenCalledTimes(1);
  });

  it("calls onNotNow from both 'Not now' and the close button while asking", async () => {
    const onNotNow = vi.fn();
    const onDismissOutcome = vi.fn();
    render(
      <DefaultAppBanner
        {...defaultProps}
        onNotNow={onNotNow}
        onDismissOutcome={onDismissOutcome}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    await userEvent.click(screen.getByRole("button", { name: DISMISS }));
    expect(onNotNow).toHaveBeenCalledTimes(2);
    expect(onDismissOutcome).not.toHaveBeenCalled();
  });

  it("takes no second 'Set as default' while the first is running", async () => {
    const onSetDefault = vi.fn();
    render(<DefaultAppBanner {...defaultProps} busy onSetDefault={onSetDefault} />);

    await userEvent.click(screen.getByRole("button", { name: "Set as default" }));
    expect(onSetDefault).not.toHaveBeenCalled();
  });

  it.each(["guidance", "sandboxed", "noDesktopEntry", "error"] as const)(
    "replaces the question with the %s line Settings shows, leaving only the close button",
    async (outcome) => {
      const onNotNow = vi.fn();
      const onDismissOutcome = vi.fn();
      render(
        <DefaultAppBanner
          {...defaultProps}
          outcome={outcome}
          onNotNow={onNotNow}
          onDismissOutcome={onDismissOutcome}
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent(enSettings.defaultApp.outcome[outcome]);
      expect(screen.queryByText("Make Glyph your default Markdown app?")).not.toBeInTheDocument();
      expect(screen.getAllByRole("button")).toHaveLength(1);

      await userEvent.click(screen.getByRole("button", { name: DISMISS }));
      expect(onDismissOutcome).toHaveBeenCalledTimes(1);
      expect(onNotNow).not.toHaveBeenCalled();
    },
  );
});
