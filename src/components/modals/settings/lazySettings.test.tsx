import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { CHUNK_LOAD_TIMEOUT_MS } from "@/test/chunkLoadTimeout";
import { SettingsModal } from "./lazySettings";

describe("lazySettings", { timeout: CHUNK_LOAD_TIMEOUT_MS }, () => {
  it("lazy-loads and renders the settings modal", async () => {
    const value: SettingsContextValue = {
      settings: DEFAULT_SETTINGS,
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
      flushSettings: async () => true,
      loaded: true,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
    );
    render(<SettingsModal open onClose={vi.fn()} />, { wrapper });

    // Resolves once the dynamically imported chunk has loaded.
    expect(
      await screen.findByText("Settings", undefined, { timeout: CHUNK_LOAD_TIMEOUT_MS }),
    ).toBeInTheDocument();
  });
});
