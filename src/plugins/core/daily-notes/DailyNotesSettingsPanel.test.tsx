import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyNotesSettingsPanel } from "./DailyNotesSettingsPanel";
import { type DailyNotesSettings, DEFAULT_SETTINGS } from "./settings";

const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

interface Settle {
  resolve: (settings: DailyNotesSettings) => void;
  reject: (reason: unknown) => void;
}

function renderPanel(over: {
  load?: () => Promise<DailyNotesSettings>;
  save?: () => Promise<void>;
}) {
  const props = {
    load: over.load ?? (async () => DEFAULT_SETTINGS),
    save: vi.fn(over.save ?? (async () => {})),
    t,
  };
  render(<DailyNotesSettingsPanel {...props} />);
  return props;
}

const folder = () => screen.findByRole("textbox", { name: /settings\.folder\.label/ });
const pattern = () => screen.getByRole("textbox", { name: /settings\.filenamePattern\.label/ });
const template = () => screen.getByRole("textbox", { name: /settings\.template\.label/ });
const saveButton = () => screen.getByRole("button", { name: "settings.save" });

beforeEach(() => {
  // Only the clock is faked, so user events and promises behave as usual.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 9, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DailyNotesSettingsPanel", () => {
  it("shows the stored settings and where today's note goes", async () => {
    renderPanel({
      load: async () => ({
        folder: "journal",
        filenamePattern: "YYYY-MM-DD.md",
        template: "templates/daily.md",
      }),
    });

    expect(await folder()).toHaveValue("journal");
    expect(pattern()).toHaveValue("YYYY-MM-DD.md");
    expect(template()).toHaveValue("templates/daily.md");
    expect(
      screen.getByText('settings.preview {"path":"journal/2026-10-08.md"}'),
    ).toBeInTheDocument();
  });

  it("keeps the fields and Save back until the settings have loaded", async () => {
    let finish!: (settings: DailyNotesSettings) => void;
    renderPanel({
      load: () =>
        new Promise<DailyNotesSettings>((resolve) => {
          finish = resolve;
        }),
    });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    finish(DEFAULT_SETTINGS);
    expect(await folder()).toHaveValue("daily");
    expect(saveButton()).toBeEnabled();
  });

  it("updates the preview while the pattern is edited, hiding it when invalid", async () => {
    const user = userEvent.setup();
    renderPanel({});
    await folder();

    await user.clear(pattern());
    expect(screen.queryByText(/settings\.preview/)).not.toBeInTheDocument();

    await user.type(pattern(), "DD-MM-YYYY");
    expect(screen.getByText('settings.preview {"path":"daily/08-10-2026.md"}')).toBeInTheDocument();
  });

  it("saves the edited fields in their stored form and says so", async () => {
    const user = userEvent.setup();
    const { save } = renderPanel({});

    await user.clear(await folder());
    await user.type(await folder(), "journal/");
    await user.type(template(), "templates\\day.md");
    await user.click(saveButton());

    expect(save).toHaveBeenCalledExactlyOnceWith({
      folder: "journal",
      filenamePattern: "YYYY-MM-DD.md",
      template: "templates/day.md",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("settings.saved");
  });

  it("drops the Saved note as soon as a field changes again", async () => {
    const user = userEvent.setup();
    renderPanel({});
    await folder();
    await user.click(saveButton());
    await screen.findByRole("status");

    await user.type(template(), "t.md");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    ["an empty pattern", "", "settings.errors.patternRequired"],
    ["a pattern that leaves the workspace", "../YYYY", "settings.errors.invalidPath"],
  ])("refuses %s with a message, saving nothing", async (_name, value, message) => {
    const user = userEvent.setup();
    const { save } = renderPanel({});
    await folder();

    await user.clear(pattern());
    if (value) await user.type(pattern(), value);
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(save).not.toHaveBeenCalled();
  });

  it("shows why the host did not save", async () => {
    const user = userEvent.setup();
    renderPanel({ save: async () => Promise.reject("plugin settings are limited to 65536 bytes") });
    await folder();

    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/limited to 65536 bytes/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows why the settings could not be read, and offers nothing to overwrite them with", async () => {
    renderPanel({ load: async () => Promise.reject("corrupt .glyph/config.json") });

    expect(await screen.findByRole("alert")).toHaveTextContent("corrupt .glyph/config.json");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // The host empties a mount's element when its tab closes; a late answer must
  // not write into a panel that is gone.
  it.each([
    ["settings", (finish: Settle) => finish.resolve(DEFAULT_SETTINGS)],
    ["a failure", (finish: Settle) => finish.reject("corrupt .glyph/config.json")],
  ])("ignores %s arriving after the panel is gone", async (_name, settle) => {
    const error = vi.spyOn(console, "error");
    const finish = {} as Settle;
    const load = () =>
      new Promise<DailyNotesSettings>((resolve, reject) => {
        Object.assign(finish, { resolve, reject });
      });
    const { unmount } = render(<DailyNotesSettingsPanel load={load} save={vi.fn()} t={t} />);

    unmount();
    settle(finish);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });
});
