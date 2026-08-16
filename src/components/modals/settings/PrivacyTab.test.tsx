import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { PrivacyTab } from "./PrivacyTab";

// Regression cover for the Privacy tab as the app actually mounts it: with the
// real useSecretSlots, not a mock of it. SecretsSection.test.tsx stubs the hook,
// so a crash inside the hook or its slot model renders green there and blows up
// the real modal.

const { hasSecretMock } = vi.hoisted(() => ({ hasSecretMock: vi.fn() }));
vi.mock("@/lib/secrets", () => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  hasSecret: hasSecretMock,
}));

function wrapper({ children }: { children: ReactNode }) {
  const value: SettingsContextValue = {
    settings: DEFAULT_SETTINGS,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

beforeEach(() => {
  hasSecretMock.mockReset().mockResolvedValue(false);
});

describe("PrivacyTab", () => {
  it("mounts with the real secret-slot hook", async () => {
    render(<PrivacyTab />, { wrapper });

    expect(screen.getByText("Claude API key")).toBeInTheDocument();
    expect(screen.getByText("OpenAI API key")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Not set")).toHaveLength(2));
  });

  it("does not depend on a workspace being open", async () => {
    // The tab is app-wide: nothing it lists is keyed by workspace path, so it
    // must mount without any workspace context in scope.
    render(<PrivacyTab />, { wrapper });

    await waitFor(() => expect(hasSecretMock).toHaveBeenCalledWith("ai-api-key-claude"));
    expect(screen.queryByText("Cloud Sync token")).not.toBeInTheDocument();
  });
});
