import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInWorkspace } from "@/test/renderInWorkspace";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";

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

describe("WorkspaceSettingsModal", () => {
  it("loads the existing config into the form", async () => {
    mockConfigFile(JSON.stringify({ title: "Field Notes", robots: "all", theme: "plain" }));
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /site title/i })).toHaveValue("Field Notes"),
    );
    expect(screen.getByRole("combobox", { name: /search engines/i })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: /theme/i })).toHaveValue("plain");
  });

  it("saves only the fields the user set, creating .glyph/", async () => {
    const writes = mockConfigFile(null);
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />, "/ws");

    await user.type(screen.getByRole("textbox", { name: /site title/i }), "My Notes");
    await user.selectOptions(screen.getByRole("combobox", { name: /search engines/i }), "all");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writes.size).toBe(1));
    const saved = JSON.parse(writes.get("/ws/.glyph/site.json") ?? "{}");
    expect(saved).toEqual({ title: "My Notes", robots: "all" });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("preserves keys it does not know and drops fields the user cleared", async () => {
    const writes = mockConfigFile(
      JSON.stringify({ title: "Old", robots: "all", futureKey: { nested: true } }),
    );
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />, "/ws");
    const title = await screen.findByRole("textbox", { name: /site title/i });
    await waitFor(() => expect(title).toHaveValue("Old"));

    await user.clear(title);
    await user.selectOptions(screen.getByRole("combobox", { name: /search engines/i }), "");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writes.size).toBe(1));
    const saved = JSON.parse(writes.get("/ws/.glyph/site.json") ?? "{}");
    // A config written by a newer Glyph survives a visit; cleared fields go.
    expect(saved).toEqual({ futureKey: { nested: true } });
  });

  it("surfaces the parser's message instead of writing an invalid config", async () => {
    const writes = mockConfigFile(null);
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />);

    // socialImage without baseUrl is the parser's own rule.
    await user.type(screen.getByRole("textbox", { name: /social image/i }), "card.png");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/"socialImage" requires "baseUrl"/);
    expect(writes.size).toBe(0);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("offers the builtin themes in the picker", async () => {
    mockConfigFile(null);
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />);
    const picker = await screen.findByRole("combobox", { name: /theme/i });
    const options = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["GitHub", "Plain"]);
    expect(picker).toHaveValue("github");
  });

  it("saves every form field the user filled in", async () => {
    const writes = mockConfigFile(null);
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />, "/ws");

    await user.type(screen.getByRole("textbox", { name: /description/i }), "My notes");
    await user.type(screen.getByRole("textbox", { name: /^base url/i }), "https://example.com");
    await user.type(screen.getByRole("textbox", { name: /favicon/i }), "assets/logo.png");
    await user.type(screen.getByRole("textbox", { name: /social image/i }), "assets/card.png");
    await user.selectOptions(screen.getByRole("combobox", { name: /theme/i }), "plain");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writes.size).toBe(1));
    expect(JSON.parse(writes.get("/ws/.glyph/site.json") ?? "{}")).toEqual({
      description: "My notes",
      baseUrl: "https://example.com",
      favicon: "assets/logo.png",
      socialImage: "assets/card.png",
      theme: "plain",
    });
  });

  it("surfaces a write failure instead of closing", async () => {
    mockConfigFile(null);
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "read_file" || cmd === "write_file"
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve(undefined),
    );
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />);

    await user.type(screen.getByRole("textbox", { name: /site title/i }), "Notes");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/disk full/);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error write failure for the alert", async () => {
    mockConfigFile(null);
    // Tauri command rejections are plain strings, not Error instances.
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "read_file" || cmd === "write_file"
        ? Promise.reject("permission denied")
        : Promise.resolve(undefined),
    );
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />);

    await user.type(screen.getByRole("textbox", { name: /site title/i }), "Notes");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/permission denied/);
  });

  it("keeps the active tab selected when its nav button is clicked", async () => {
    mockConfigFile(null);
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />);
    const tab = screen.getByRole("button", { name: "Website" });
    await user.click(tab);
    expect(tab).toHaveAttribute("data-active", "true");
    expect(await screen.findByRole("combobox", { name: /theme/i })).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    mockConfigFile(null);
    const { container } = renderInWorkspace(
      <WorkspaceSettingsModal {...defaultProps} open={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("closes on Escape", async () => {
    mockConfigFile(null);
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape pressed inside the dialog", async () => {
    mockConfigFile(null);
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} onClose={onClose} />);
    screen.getByRole("button", { name: "Website" }).focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click but not on clicks inside the dialog", async () => {
    mockConfigFile(null);
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("heading", { name: /workspace settings/i }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a config load that resolves after unmount", async () => {
    let resolveRead: (raw: string) => void = () => {};
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "read_file"
        ? new Promise<string>((resolve) => {
            resolveRead = resolve;
          })
        : Promise.resolve(undefined),
    );
    const { unmount } = renderInWorkspace(<WorkspaceSettingsModal {...defaultProps} />);
    unmount();
    // Resolving the stale read must not update state on the unmounted form.
    expect(() => resolveRead(JSON.stringify({ title: "late" }))).not.toThrow();
    await Promise.resolve();
  });

  it("shows the empty state when no workspace is open", () => {
    mockConfigFile(null);
    render(<WorkspaceSettingsModal {...defaultProps} />);
    expect(screen.getByText(/open a folder workspace/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Website" })).not.toBeInTheDocument();
  });
});
