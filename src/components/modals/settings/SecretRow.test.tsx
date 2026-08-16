import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecretRow } from "./SecretRow";

const defaultProps = {
  label: "Claude API key",
  isSet: true as boolean | null | undefined,
  busy: false,
  onRemove: vi.fn(),
  onSave: vi.fn(),
};

const removeButton = () => screen.getByRole("button", { name: "Remove Claude API key" });
const replaceButton = () => screen.getByRole("button", { name: "Replace Claude API key" });
const field = () => screen.getByLabelText("New value for Claude API key");

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
    expect(screen.getByRole("button", { name: "Add Claude API key" })).toBeEnabled();
    expect(removeButton()).toBeDisabled();
  });

  it("says it is still checking rather than guessing", () => {
    render(<SecretRow {...defaultProps} isSet={undefined} />);

    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't be checked")).not.toBeInTheDocument();
    // Nothing may be written against a slot whose state isn't known yet.
    expect(replaceButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
  });

  it("keeps an unreadable slot out of the 'not set' state", () => {
    render(<SecretRow {...defaultProps} isSet={null} />);

    expect(screen.getByText("Couldn't be checked")).toBeInTheDocument();
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
    // Unknown means removal and Replace stay available: it may well be stored.
    expect(removeButton()).toBeEnabled();
    expect(replaceButton()).toBeEnabled();
  });

  it("opens an empty password field for a replacement", () => {
    render(<SecretRow {...defaultProps} />);
    fireEvent.click(replaceButton());

    expect(field()).toHaveValue("");
    expect(field()).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves the typed value, then clears and closes the field", () => {
    const onSave = vi.fn();
    render(<SecretRow {...defaultProps} onSave={onSave} />);
    fireEvent.click(replaceButton());
    fireEvent.change(field(), { target: { value: "sk-ant-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("sk-ant-new");
    expect(screen.queryByLabelText("New value for Claude API key")).not.toBeInTheDocument();

    // Reopening starts blank rather than restoring what was typed.
    fireEvent.click(replaceButton());
    expect(field()).toHaveValue("");
  });

  it("trims the value and refuses a blank one", () => {
    const onSave = vi.fn();
    render(<SecretRow {...defaultProps} onSave={onSave} />);
    fireEvent.click(replaceButton());

    fireEvent.change(field(), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(field(), { target: { value: "  sk-ant-new  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("sk-ant-new");
  });

  it("discards the typed value on cancel", () => {
    const onSave = vi.fn();
    render(<SecretRow {...defaultProps} onSave={onSave} />);
    fireEvent.click(replaceButton());
    fireEvent.change(field(), { target: { value: "sk-ant-typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(replaceButton());
    expect(field()).toHaveValue("");
  });

  it("does not park the typed secret when the field is collapsed via Replace", () => {
    render(<SecretRow {...defaultProps} />);
    fireEvent.click(replaceButton());
    fireEvent.change(field(), { target: { value: "sk-ant-secret" } });
    fireEvent.click(replaceButton());

    expect(screen.queryByLabelText("New value for Claude API key")).not.toBeInTheDocument();
    fireEvent.click(replaceButton());
    expect(field()).toHaveValue("");
  });

  it("removes on request", () => {
    const onRemove = vi.fn();
    render(<SecretRow {...defaultProps} onRemove={onRemove} />);
    fireEvent.click(removeButton());

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("locks the row while a write is in flight", () => {
    render(<SecretRow {...defaultProps} busy />);

    expect(replaceButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
  });

  it("names the slot each button acts on", () => {
    render(<SecretRow {...defaultProps} label="Cloud Sync token" />);

    // Three rows of bare "Remove" buttons are indistinguishable by ear.
    expect(screen.getByRole("button", { name: "Remove Cloud Sync token" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace Cloud Sync token" })).toBeInTheDocument();
  });
});
