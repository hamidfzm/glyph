import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "@/hooks/useTabs";
import type { UnsavedChoice } from "@/hooks/useUnsavedChangesPrompt";
import { TabsProvider } from "./TabsProvider";

vi.mock("@/hooks/useTabs", () => ({ useTabs: vi.fn() }));

/** The slice of useTabs the provider itself reads; the rest is passed through. */
const tabsStub = {
  tabs: [],
  activeFile: null,
  wikilinkRefs: [],
  workspaceFiles: [],
  metadataEntries: [],
};

/** Render the provider and hand back the `confirmUnsaved` it wired into useTabs. */
function renderProvider() {
  vi.mocked(useTabs).mockReturnValue(tabsStub as unknown as ReturnType<typeof useTabs>);
  render(<TabsProvider>{null}</TabsProvider>);
  const options = vi.mocked(useTabs).mock.calls.at(-1)?.[0];
  if (!options) throw new Error("useTabs was not called");
  return options.confirmUnsaved;
}

describe("TabsProvider", () => {
  beforeEach(() => {
    vi.mocked(useTabs).mockReset();
  });

  it("shows no prompt until a close asks for one", () => {
    renderProvider();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the prompt for the close coordinator and resolves with the user's choice", async () => {
    const confirmUnsaved = renderProvider();

    let choice: Promise<UnsavedChoice> | undefined;
    act(() => {
      choice = confirmUnsaved(["/p/a.md"]);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("a.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Don't Save" }));

    await expect(choice).resolves.toBe("discard");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
