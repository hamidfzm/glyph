import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { mergeChangedPaths } from "@/lib/settingsWrite";
import strings from "@/locales/en/settings.json";
import { AgentToolsSection } from "./AgentToolsSection";

// The names the Rust registry gives its write tools: `mcp::tests` holds the
// registry to the same file, so a tool added there without its switch and its
// strings fails here.
const WRITE_TOOLS: string[] = JSON.parse(
  readFileSync(path.join(process.cwd(), "src-tauri", "fixtures", "mcp-write-tools.json"), "utf-8"),
);

function withTools(on: Record<string, boolean>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ai: {
      ...DEFAULT_SETTINGS.ai,
      agentWriteTools: { ...DEFAULT_SETTINGS.ai.agentWriteTools, ...on },
    },
  };
}

function setup(on: Record<string, boolean> = {}) {
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings: withTools(on),
    updateSettings,
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  render(<AgentToolsSection />, { wrapper });
  return { updateSettings };
}

describe("AgentToolsSection", () => {
  it("offers one toggle per write tool, all off by default", () => {
    setup();

    expect(screen.getByText(/can always read your open workspaces/)).toBeInTheDocument();
    const toggles = screen.getAllByRole("checkbox");
    expect(toggles).toHaveLength(WRITE_TOOLS.length);
    for (const toggle of toggles) expect(toggle).not.toBeChecked();
  });

  it("has a switch, a label and a description for every tool the registry names", () => {
    expect(Object.keys(DEFAULT_SETTINGS.ai.agentWriteTools)).toEqual(WRITE_TOOLS);
    expect(Object.values(DEFAULT_SETTINGS.ai.agentWriteTools)).toEqual(
      WRITE_TOOLS.map(() => false),
    );
    expect(Object.keys(strings.ai.agentTools.tools)).toEqual(WRITE_TOOLS);
    for (const entry of Object.values(strings.ai.agentTools.tools)) {
      expect(entry.label).not.toBe("");
      expect(entry.description).not.toBe("");
    }
  });

  it("turning one tool on writes that tool's switch alone", async () => {
    const { updateSettings } = setup({ update_task: true });

    expect(screen.getByRole("checkbox", { name: "Check off tasks" })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Rename notes" }));

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("ai.agentWriteTools.rename_note", true);
  });

  it("turning a tool off writes that tool's switch alone", async () => {
    const { updateSettings } = setup({ patch_note: true, update_task: true });

    await userEvent.click(screen.getByRole("checkbox", { name: "Check off tasks" }));

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("ai.agentWriteTools.update_task", false);
  });

  it("a window that loaded earlier does not turn back on what another turned off", () => {
    // Another window turned rename_note off after this one loaded with it on.
    // This one turns update_task on; only that path is replayed over the store.
    const stored = withTools({ patch_note: true });
    const stale = withTools({ patch_note: true, rename_note: true, update_task: true });

    const written = mergeChangedPaths(stored, stale, new Set(["ai.agentWriteTools.update_task"]));

    expect(written.ai.agentWriteTools).toEqual({
      patch_note: true,
      set_property: false,
      update_task: true,
      rename_note: false,
      move_note: false,
    });
  });
});
