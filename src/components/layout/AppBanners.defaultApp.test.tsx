import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";
import { TabsContext } from "@/contexts/TabsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { setNestedValue } from "@/lib/settingsObject";
import { tabsContextValue } from "@/test/fixtures/tabsContext";
import { AppBanners } from "./AppBanners";

// The first-run flow end to end: the real prompt hooks and banners over a
// settings object that takes their writes, with only the command stubbed.
const { setDefaultMock } = vi.hoisted(() => ({ setDefaultMock: vi.fn() }));
vi.mock("@/lib/defaultApp", () => ({ setDefaultMarkdownApp: setDefaultMock }));
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => ({ update: null, dismiss: vi.fn() }),
}));

const QUESTION = "Make Glyph your default Markdown app?";
const CRASH_QUESTION = /crash reports/;

function FirstRunSettings({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const updateSettings = (path: string, value: unknown) =>
    setSettings((prev) => setNestedValue({ ...prev }, path, value) as unknown as Settings);

  return (
    <SettingsContext
      value={{
        settings,
        updateSettings,
        resetSettings: vi.fn(),
        flushSettings: async () => true,
        loaded: true,
      }}
    >
      <output>{settings.behavior.defaultAppPrompt}</output>
      {children}
    </SettingsContext>
  );
}

function renderFirstRun() {
  render(
    <FirstRunSettings>
      <TabsContext.Provider value={tabsContextValue()}>
        <AppBanners />
      </TabsContext.Provider>
    </FirstRunSettings>,
  );
}

async function clickSetDefault() {
  await userEvent.click(screen.getByRole("button", { name: "Set as default" }));
}

async function dismissDefaultApp() {
  await userEvent.click(screen.getByRole("button", { name: "Dismiss default-app prompt" }));
}

describe("AppBanners default-app prompt", () => {
  beforeEach(() => {
    setDefaultMock.mockReset();
  });

  it("stores 'set' and moves on to the crash-reporting prompt when the platform took over", async () => {
    setDefaultMock.mockResolvedValue("openedSettings");
    renderFirstRun();
    expect(screen.queryByText(CRASH_QUESTION)).not.toBeInTheDocument();

    await clickSetDefault();

    expect(await screen.findByText("set")).toBeInTheDocument();
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(screen.getByText(CRASH_QUESTION)).toBeInTheDocument();
  });

  it("keeps the manual steps up, alone, until they are dismissed as 'guided'", async () => {
    setDefaultMock.mockResolvedValue("guidance");
    renderFirstRun();

    await clickSetDefault();

    expect(await screen.findByText(/right-click a Markdown file/)).toBeInTheDocument();
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(screen.getByText("unanswered")).toBeInTheDocument();
    expect(screen.queryByText(CRASH_QUESTION)).not.toBeInTheDocument();

    await dismissDefaultApp();

    expect(screen.getByText("guided")).toBeInTheDocument();
    expect(screen.queryByText(/right-click a Markdown file/)).not.toBeInTheDocument();
    expect(screen.getByText(CRASH_QUESTION)).toBeInTheDocument();
  });

  it("reports a failure and leaves the question for the next launch", async () => {
    setDefaultMock.mockResolvedValue("error");
    renderFirstRun();

    await clickSetDefault();

    expect(await screen.findByText(/Couldn't set the default app/)).toBeInTheDocument();

    await dismissDefaultApp();

    expect(screen.queryByText(/Couldn't set the default app/)).not.toBeInTheDocument();
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(screen.getByText("unanswered")).toBeInTheDocument();
    expect(screen.queryByText(CRASH_QUESTION)).not.toBeInTheDocument();
  });
});
