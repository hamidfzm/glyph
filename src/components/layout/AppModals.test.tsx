import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppModals as AppModalsState } from "@/hooks/useAppModals";
import { restoreRaf, stubRaf } from "@/test/raf";
import { AppModals } from "./AppModals";

vi.mock("@/components/modals/settings/lazySettings", () => ({
  SettingsModal: () => <div>settings modal</div>,
}));
const workspaceMounts = vi.hoisted(() => vi.fn());
vi.mock("@/components/modals/workspace/lazyWorkspaceSettings", () => ({
  WorkspaceSettingsModal: () => {
    useEffect(() => workspaceMounts(), []);
    return <div>workspace modal</div>;
  },
}));

const CASES = [
  { flag: "settingsOpen", text: "settings modal" },
  { flag: "workspaceSettingsTab", text: "workspace modal" },
] as const;

function state(open?: (typeof CASES)[number]["flag"]): AppModalsState {
  return {
    settingsOpen: open === "settingsOpen",
    settingsTab: "appearance",
    workspaceSettingsTab: open === "workspaceSettingsTab" ? "website" : null,
    settingsOnTop: false,
    setSettingsTab: vi.fn(),
    setWorkspaceSettingsTab: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openSyncSettings: vi.fn(),
    openWorkspaceSettings: vi.fn(),
    closeWorkspaceSettings: vi.fn(),
    openPlugins: vi.fn(),
  };
}

describe("AppModals", () => {
  // Each modal is mounted only while open, so its chunk stays unloaded at
  // startup; a modal rendered hidden would defeat that.
  it("mounts nothing while every modal is closed", () => {
    const { container } = render(<AppModals modals={state()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(CASES)("mounts only the $flag modal", ({ flag, text }) => {
    render(<AppModals modals={state(flag)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    for (const other of CASES.filter((c) => c.flag !== flag)) {
      expect(screen.queryByText(other.text)).not.toBeInTheDocument();
    }
  });

  it("stacks the later-opened settings modal on top without remounting the other", () => {
    const bothOpen = { ...state("settingsOpen"), workspaceSettingsTab: "website" as const };
    const { rerender } = render(<AppModals modals={bothOpen} />);
    const isAbove = (upper: string, lower: string) =>
      Boolean(
        screen.getByText(lower).compareDocumentPosition(screen.getByText(upper)) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    expect(isAbove("workspace modal", "settings modal")).toBe(true);

    workspaceMounts.mockClear();
    rerender(<AppModals modals={{ ...bothOpen, settingsOnTop: true }} />);
    expect(isAbove("settings modal", "workspace modal")).toBe(true);
    expect(workspaceMounts).not.toHaveBeenCalled();
  });

  describe("settings exit spring", () => {
    afterEach(restoreRaf);

    it("keeps settings mounted while the close spring runs, then unmounts", () => {
      const raf = stubRaf();
      const { rerender } = render(<AppModals modals={state("settingsOpen")} />);
      act(() => raf.settle());

      rerender(<AppModals modals={state()} />);
      expect(screen.getByText("settings modal")).toBeInTheDocument();

      act(() => raf.settle());
      expect(screen.queryByText("settings modal")).not.toBeInTheDocument();
    });
  });
});
