import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppModals as AppModalsState } from "@/hooks/useAppModals";
import { restoreRaf, stubRaf } from "@/test/raf";
import { AppModals } from "./AppModals";

vi.mock("@/components/modals/settings/lazySettings", () => ({
  SettingsModal: () => <div>settings modal</div>,
}));
vi.mock("@/components/modals/workspace/WorkspaceSettingsModal", () => ({
  WorkspaceSettingsModal: () => <div>workspace modal</div>,
}));
vi.mock("@/components/plugins/PluginsModal", () => ({
  PluginsModal: () => <div>plugins modal</div>,
}));

const CASES = [
  { flag: "settingsOpen", text: "settings modal" },
  { flag: "workspaceSettingsTab", text: "workspace modal" },
  { flag: "pluginsOpen", text: "plugins modal" },
] as const;

function state(open?: (typeof CASES)[number]["flag"]): AppModalsState {
  return {
    settingsOpen: open === "settingsOpen",
    workspaceSettingsTab: open === "workspaceSettingsTab" ? "website" : null,
    pluginsOpen: open === "pluginsOpen",
    setWorkspaceSettingsTab: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openSyncSettings: vi.fn(),
    openWorkspaceSettings: vi.fn(),
    closeWorkspaceSettings: vi.fn(),
    openPlugins: vi.fn(),
    closePlugins: vi.fn(),
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
