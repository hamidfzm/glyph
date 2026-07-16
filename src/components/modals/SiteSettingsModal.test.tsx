import { invoke } from "@tauri-apps/api/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInWorkspace } from "@/test/renderInWorkspace";
import { SiteSettingsModal } from "./SiteSettingsModal";

const defaultProps = { open: true, onClose: vi.fn() };

function mockConfigFile(content: string | null): Map<string, string> {
  const writes = new Map<string, string>();
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, string>;
    switch (cmd) {
      case "read_file":
        return content === null ? Promise.reject(new Error("not found")) : Promise.resolve(content);
      case "create_dir_all":
        return Promise.resolve(undefined);
      case "write_file":
        writes.set(a.path, a.content);
        return Promise.resolve(undefined);
      default:
        return Promise.reject(new Error(`unexpected command ${cmd}`));
    }
  });
  return writes;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  defaultProps.onClose = vi.fn();
});

describe("SiteSettingsModal", () => {
  it("loads the existing config into the form", async () => {
    mockConfigFile(JSON.stringify({ title: "Field Notes", robots: "all", theme: "plain" }));
    renderInWorkspace(<SiteSettingsModal {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /site title/i })).toHaveValue("Field Notes"),
    );
    expect(screen.getByRole("combobox", { name: /search engines/i })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: /theme/i })).toHaveValue("plain");
  });

  it("saves only the fields the user set, creating .glyph/", async () => {
    const writes = mockConfigFile(null);
    const user = userEvent.setup();
    renderInWorkspace(<SiteSettingsModal {...defaultProps} />, "/ws");

    await user.type(screen.getByRole("textbox", { name: /site title/i }), "My Notes");
    await user.selectOptions(screen.getByRole("combobox", { name: /search engines/i }), "all");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writes.size).toBe(1));
    const saved = JSON.parse(writes.get("/ws/.glyph/site.json") ?? "{}");
    expect(saved).toEqual({ title: "My Notes", robots: "all" });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("surfaces the parser's message instead of writing an invalid config", async () => {
    const writes = mockConfigFile(null);
    const user = userEvent.setup();
    renderInWorkspace(<SiteSettingsModal {...defaultProps} />);

    // socialImage without baseUrl is the parser's own rule.
    await user.type(screen.getByRole("textbox", { name: /social image/i }), "card.png");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/"socialImage" requires "baseUrl"/);
    expect(writes.size).toBe(0);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("offers the builtin themes in the picker", async () => {
    mockConfigFile(null);
    renderInWorkspace(<SiteSettingsModal {...defaultProps} />);
    const picker = await screen.findByRole("combobox", { name: /theme/i });
    const options = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["GitHub", "Plain"]);
    expect(picker).toHaveValue("github");
  });
});
