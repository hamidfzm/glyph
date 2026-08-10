import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecretRow } from "./SecretRow";

const defaultProps = {
  label: "Claude API key",
  isSet: true as boolean | null,
  busy: false,
  onRemove: vi.fn(),
  onSave: vi.fn(),
};

const removeButton = () => screen.getByRole("button", { name: "Remove" });

describe("SecretRow", () => {
  it("reports a filled slot without exposing the stored value", () => {
    const { container } = render(<SecretRow {...defaultProps} />);

    expect(screen.getByText("Claude API key")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    // Nothing to reveal: the row holds no input until Replace is pressed.
    expect(container.querySelector("input")).toBeNull();
  });

  it("offers Add and blocks Remove when nothing is stored", () => {
    render(<SecretRow {...defaultProps} isSet={false} />);

    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    expect(removeButton()).toBeDisabled();
  });

  it("keeps an unreadable slot out of the 'not set' state", () => {
    render(<SecretRow {...defaultProps} isSet={null} />);

    expect(screen.getByText("Couldn't be checked")).toBeInTheDocument();
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
    // Unknown means removal and Replace stay available: it may well be stored.
    expect(removeButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Replace" })).toBeEnabled();
  });

  it("opens an empty password field for a replacement", () => {
    render(<SecretRow {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    const field = screen.getByLabelText("New value for Claude API key");
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves the typed value, then clears and closes the field", () => {
    const onSave = vi.fn();
    render(<SecretRow {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.change(screen.getByLabelText("New value for Claude API key"), {
      target: { value: "sk-ant-new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("sk-ant-new");
    expect(screen.queryByLabelText("New value for Claude API key")).not.toBeInTheDocument();

    // Reopening starts blank rather than restoring what was typed.
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByLabelText("New value for Claude API key")).toHaveValue("");
  });

  it("discards the typed value on cancel", () => {
    const onSave = vi.fn();
    render(<SecretRow {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.change(screen.getByLabelText("New value for Claude API key"), {
      target: { value: "sk-ant-typed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByLabelText("New value for Claude API key")).toHaveValue("");
  });

  it("closes the field when Replace is pressed again", () => {
    render(<SecretRow {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(screen.queryByLabelText("New value for Claude API key")).not.toBeInTheDocument();
  });

  it("removes on request", () => {
    const onRemove = vi.fn();
    render(<SecretRow {...defaultProps} onRemove={onRemove} />);
    fireEvent.click(removeButton());

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("locks the row while a write is in flight", () => {
    render(<SecretRow {...defaultProps} busy />);

    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
    expect(removeButton()).toBeDisabled();
  });

  it("explains why an unreachable slot cannot be managed", () => {
    render(
      <SecretRow
        {...defaultProps}
        isSet={null}
        unavailableHint="Open a folder to manage its sync token."
      />,
    );

    expect(screen.getByText("Open a folder to manage its sync token.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't be checked")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
    expect(removeButton()).toBeDisabled();
  });
});
