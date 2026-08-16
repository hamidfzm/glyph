import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseSecretSlotsReturn } from "@/hooks/useSecretSlots";
import { SECRET_SLOTS } from "@/lib/secretSlots";
import { SecretsSection } from "./SecretsSection";

const { useSecretSlotsMock } = vi.hoisted(() => ({ useSecretSlotsMock: vi.fn() }));
vi.mock("@/hooks/useSecretSlots", () => ({ useSecretSlots: useSecretSlotsMock }));

let remove: ReturnType<typeof vi.fn<UseSecretSlotsReturn["remove"]>>;
let save: ReturnType<typeof vi.fn<UseSecretSlotsReturn["save"]>>;

function mockSlots(overrides: Partial<UseSecretSlotsReturn> = {}) {
  useSecretSlotsMock.mockReturnValue({
    slots: SECRET_SLOTS,
    presence: { "ai-claude": true, "ai-openai": false },
    busySlotId: null,
    errorKey: null,
    remove,
    save,
    ...overrides,
  } satisfies UseSecretSlotsReturn);
}

beforeEach(() => {
  remove = vi.fn<UseSecretSlotsReturn["remove"]>();
  save = vi.fn<UseSecretSlotsReturn["save"]>();
  mockSlots();
});

describe("SecretsSection", () => {
  it("lists every managed slot with its masked status", () => {
    const { container } = render(<SecretsSection />);

    expect(screen.getByText("Claude API key")).toBeInTheDocument();
    expect(screen.getByText("OpenAI API key")).toBeInTheDocument();
    // Per-workspace secrets are not listed here: the Cloud Sync token is
    // managed in that workspace's own Sync settings tab.
    expect(screen.queryByText("Cloud Sync token")).not.toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    // The list is presence only: no field can hold a stored value.
    expect(container.querySelector("input")).toBeNull();
  });

  it("removes only the slot whose button was pressed", () => {
    render(<SecretsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Claude API key" }));

    expect(remove).toHaveBeenCalledExactlyOnceWith(SECRET_SLOTS[0]);
  });

  it("saves a replacement against the right slot", () => {
    render(<SecretsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Replace Claude API key" }));
    fireEvent.change(screen.getByLabelText("New value for Claude API key"), {
      target: { value: "sk-ant-new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(save).toHaveBeenCalledExactlyOnceWith(SECRET_SLOTS[0], "sk-ant-new");
  });

  it("says it is still checking before the first lookup answers", () => {
    mockSlots({ presence: {} });
    render(<SecretsSection />);

    // A security audit view must not open on three "Couldn't be checked" rows.
    expect(screen.getAllByText("Checking…")).toHaveLength(SECRET_SLOTS.length);
    expect(screen.queryByText("Couldn't be checked")).not.toBeInTheDocument();
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  });

  it("locks every row while one slot is being written", () => {
    mockSlots({ busySlotId: "ai-claude" });
    render(<SecretsSection />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("surfaces a keychain failure", () => {
    mockSlots({ errorKey: "secrets.errors.remove" });
    render(<SecretsSection />);

    expect(screen.getByText("Couldn't remove the secret from the keychain.")).toBeInTheDocument();
  });
});
