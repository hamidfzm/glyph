import { openUrl } from "@tauri-apps/plugin-opener";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { checkForUpdate } from "@/lib/updateCheck";
import { UpdatesSection } from "./UpdatesSection";

vi.mock("@/lib/updateCheck", () => ({
  checkForUpdate: vi.fn(),
}));

const mockedCheck = vi.mocked(checkForUpdate);

function renderWith(overrides: Partial<SettingsContextValue> = {}) {
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings: DEFAULT_SETTINGS,
    updateSettings,
    resetSettings: vi.fn(),
    loaded: true,
    ...overrides,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  render(<UpdatesSection />, { wrapper });
  return { updateSettings };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("UpdatesSection", () => {
  it("toggles the check-for-updates setting", async () => {
    const { updateSettings } = renderWith();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(updateSettings).toHaveBeenCalledWith("behavior.checkForUpdates", false);
  });

  it("reports when already up to date", async () => {
    mockedCheck.mockResolvedValue({ status: "current", currentVersion: "0.8.1" });
    renderWith();
    await userEvent.click(screen.getByRole("button", { name: "Check Now" }));
    expect(await screen.findByText(/on the latest version/i)).toBeInTheDocument();
  });

  it("offers a download link when an update is available", async () => {
    mockedCheck.mockResolvedValue({
      status: "available",
      latestVersion: "0.9.0",
      currentVersion: "0.8.1",
      url: "https://example.com/0.9.0",
    });
    renderWith();
    await userEvent.click(screen.getByRole("button", { name: "Check Now" }));

    expect(await screen.findByText(/Version 0\.9\.0 is available/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/0.9.0");
  });

  it("reports an error when the check fails", async () => {
    mockedCheck.mockResolvedValue({ status: "error" });
    renderWith();
    await userEvent.click(screen.getByRole("button", { name: "Check Now" }));
    expect(await screen.findByText(/Couldn't check for updates/i)).toBeInTheDocument();
  });
});
