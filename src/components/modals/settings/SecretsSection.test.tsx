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
    presence: { "ai-claude": true, "ai-openai": false, "sync-token": false },
    workspacePath: "/ws",
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
    expect(screen.getByText("Cloud Sync token")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    // The list is presence only: no field can hold a stored value.
    expect(container.querySelector("input")).toBeNull();
  });

  it("removes only the slot whose button was pressed", () => {
    render(<SecretsSection />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    expect(remove).toHaveBeenCalledExactlyOnceWith(SECRET_SLOTS[0]);
  });

  it("saves a replacement against the right slot", () => {
    render(<SecretsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.change(screen.getByLabelText("New value for Claude API key"), {
      target: { value: "sk-ant-new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(save).toHaveBeenCalledExactlyOnceWith(SECRET_SLOTS[0], "sk-ant-new");
  });

  it("explains that the sync token needs an open folder", () => {
    mockSlots({ workspacePath: undefined, presence: { "sync-token": null } });
    render(<SecretsSection />);

    expect(screen.getByText("Open a folder to manage its sync token.")).toBeInTheDocument();
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
