import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyNotesSettings } from "@/lib/workspace";
import { mockStoredDailyNotes } from "@/test/dailyNotes";
import { deferred } from "@/test/deferred";
import { renderInWorkspace } from "@/test/renderInWorkspace";
import { DailyNotesSettingsTab } from "./DailyNotesSettingsTab";

vi.mock("@tauri-apps/api/core");

const defaultProps = { onClose: vi.fn() };

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  mockStoredDailyNotes({ folder: "daily", filenamePattern: "YYYY-MM-DD.md" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 9, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DailyNotesSettingsTab", () => {
  it("renders nothing without a workspace root", () => {
    const { container } = render(<DailyNotesSettingsTab {...defaultProps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the stored settings and where today's note goes", async () => {
    mockStoredDailyNotes({
      folder: "journal",
      filenamePattern: "YYYY-MM-DD.md",
      template: "templates/daily.md",
    });
    renderInWorkspace(<DailyNotesSettingsTab {...defaultProps} />);

    expect(await screen.findByRole("textbox", { name: /folder/i })).toHaveValue("journal");
    expect(screen.getByRole("textbox", { name: /file name pattern/i })).toHaveValue(
      "YYYY-MM-DD.md",
    );
    expect(screen.getByRole("textbox", { name: /template file/i })).toHaveValue(
      "templates/daily.md",
    );
    expect(screen.getByText("Today's note: journal/2026-10-08.md")).toBeInTheDocument();
  });

  it("updates the preview while the pattern is edited, hiding it when invalid", async () => {
    const user = userEvent.setup();
    renderInWorkspace(<DailyNotesSettingsTab {...defaultProps} />);
    const pattern = await screen.findByRole("textbox", { name: /file name pattern/i });

    await user.clear(pattern);
    expect(screen.queryByText(/today's note:/i)).not.toBeInTheDocument();

    await user.type(pattern, "DD-MM-YYYY");
    expect(screen.getByText("Today's note: daily/08-10-2026.md")).toBeInTheDocument();
  });

  it("saves the edited fields and closes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderInWorkspace(<DailyNotesSettingsTab onClose={onClose} />, "/ws");
    const folder = await screen.findByRole("textbox", { name: /folder/i });

    await user.clear(folder);
    await user.type(folder, "journal");
    await user.type(screen.getByRole("textbox", { name: /template file/i }), "templates/day.md");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("workspace_set_daily_notes", {
      workspaceRoot: "/ws",
      settings: {
        folder: "journal",
        filenamePattern: "YYYY-MM-DD.md",
        template: "templates/day.md",
      },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows why invalid settings were not saved and stays open", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderInWorkspace(<DailyNotesSettingsTab onClose={onClose} />);

    await user.clear(await screen.findByRole("textbox", { name: /file name pattern/i }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter a file name pattern/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps Save disabled until the stored settings have loaded", async () => {
    const stored = deferred<DailyNotesSettings>();
    vi.mocked(invoke).mockReturnValue(stored.promise as never);
    renderInWorkspace(<DailyNotesSettingsTab {...defaultProps} />);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    stored.resolve({ folder: "daily", filenamePattern: "YYYY-MM-DD.md" });
    expect(await screen.findByRole("textbox", { name: /folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("closes without saving on Cancel", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderInWorkspace(<DailyNotesSettingsTab onClose={onClose} />);
    await screen.findByRole("textbox", { name: /folder/i });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalledWith("workspace_set_daily_notes", expect.anything());
  });
});
