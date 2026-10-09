import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatedFile, GlyphPluginContext } from "@/lib/plugins/types";
import { createTodaysNoteOpener } from "./openTodaysNote";

const TODAY = "/ws/daily/2026-10-08.md";

interface FakeOptions {
  settings?: Record<string, unknown>;
  /** Workspace files by relative path; reading anything else rejects. */
  files?: Record<string, string>;
}

function fakeContext({ settings = {}, files = {} }: FakeOptions = {}) {
  const state = { root: "/ws" as string | null };
  const ctx = {
    workspace: {
      getRoot: vi.fn(() => state.root),
      getSettings: vi.fn(async () => settings),
      readFile: vi.fn(async (path: string) => {
        if (path in files) return files[path];
        throw new Error(`Failed to read file: ${path}`);
      }),
      createFile: vi.fn(
        async (_path: string, _content?: string): Promise<CreatedFile> => ({
          path: TODAY,
          created: true,
        }),
      ),
    },
    navigation: { openFile: vi.fn() },
    notify: vi.fn(),
  };
  const t = vi.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  );
  const open = createTodaysNoteOpener(ctx as unknown as GlyphPluginContext, t);
  return { ctx, state, open };
}

beforeEach(() => {
  // Only the clock is faked, so promises behave as usual.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 9, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTodaysNoteOpener", () => {
  it("creates today's note from the default settings and opens it", async () => {
    const { ctx, open } = fakeContext();

    await open();

    expect(ctx.workspace.createFile).toHaveBeenCalledWith("daily/2026-10-08.md", "");
    expect(ctx.navigation.openFile).toHaveBeenCalledWith(TODAY);
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("follows the workspace's folder and pattern", async () => {
    const { ctx, open } = fakeContext({
      settings: { folder: "journal", filenamePattern: "YYYY/DD-MM" },
    });

    await open();

    expect(ctx.workspace.createFile).toHaveBeenCalledWith("journal/2026/08-10.md", "");
  });

  it("starts a new note as a copy of the template", async () => {
    const { ctx, open } = fakeContext({
      settings: { template: "templates/daily.md" },
      files: { "templates/daily.md": "# {{date}}\n" },
    });

    await open();

    expect(ctx.workspace.createFile).toHaveBeenCalledWith("daily/2026-10-08.md", "# {{date}}\n");
  });

  it("opens the path the host reports, which may be spelled differently on disk", async () => {
    const { ctx, open } = fakeContext();
    ctx.workspace.createFile.mockResolvedValue({ path: "/ws/Daily/2026-10-08.md", created: false });

    await open();

    expect(ctx.navigation.openFile).toHaveBeenCalledWith("/ws/Daily/2026-10-08.md");
  });

  it("still opens a note that exists when its template has gone missing", async () => {
    const { ctx, open } = fakeContext({
      settings: { template: "templates/gone.md" },
      files: { "daily/2026-10-08.md": "what I wrote this morning" },
    });
    ctx.workspace.createFile.mockResolvedValue({ path: TODAY, created: false });

    await open();

    // Nothing to seed it with: the create-only call leaves the note as it is.
    expect(ctx.workspace.createFile).toHaveBeenCalledWith("daily/2026-10-08.md", "");
    expect(ctx.navigation.openFile).toHaveBeenCalledWith(TODAY);
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("creates nothing when a new note's template cannot be read, and says why", async () => {
    const { ctx, open } = fakeContext({ settings: { template: "templates/gone.md" } });

    await open();

    expect(ctx.workspace.createFile).not.toHaveBeenCalled();
    expect(ctx.navigation.openFile).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith(
      'failed {"error":"Failed to read file: templates/gone.md"}',
    );
  });

  it.each([
    ["patternRequired", { filenamePattern: "  " }],
    ["invalidPath", { folder: "../outside" }],
    ["invalidPath", { template: "C:\\secrets.md" }],
  ])(
    "refuses hand-edited settings with a %s problem before touching a file",
    async (problem, settings) => {
      const { ctx, open } = fakeContext({ settings });

      await open();

      expect(ctx.notify).toHaveBeenCalledWith(`problem.${problem}`);
      expect(ctx.workspace.readFile).not.toHaveBeenCalled();
      expect(ctx.workspace.createFile).not.toHaveBeenCalled();
    },
  );

  it("reports a host refusal, such as a non-Error rejection from the backend", async () => {
    const { ctx, open } = fakeContext();
    ctx.workspace.createFile.mockRejectedValue("A folder already has that name");

    await open();

    expect(ctx.notify).toHaveBeenCalledWith('failed {"error":"A folder already has that name"}');
    expect(ctx.navigation.openFile).not.toHaveBeenCalled();
  });

  it("reports unreadable settings", async () => {
    const { ctx, open } = fakeContext();
    ctx.workspace.getSettings.mockRejectedValue(new Error("corrupt .glyph/config.json"));

    await open();

    expect(ctx.notify).toHaveBeenCalledWith('failed {"error":"corrupt .glyph/config.json"}');
    expect(ctx.workspace.createFile).not.toHaveBeenCalled();
  });

  it("ignores a repeat while a request is still in flight", async () => {
    const { ctx, open } = fakeContext();
    let release!: (file: CreatedFile) => void;
    ctx.workspace.createFile.mockReturnValue(
      new Promise<CreatedFile>((resolve) => {
        release = resolve;
      }),
    );

    const first = open();
    await open();
    await vi.waitFor(() => expect(ctx.workspace.createFile).toHaveBeenCalledOnce());
    release({ path: TODAY, created: true });
    await first;

    expect(ctx.workspace.createFile).toHaveBeenCalledOnce();
    expect(ctx.navigation.openFile).toHaveBeenCalledOnce();
  });

  it("takes a new request once the previous one settled, even after a failure", async () => {
    const { ctx, open } = fakeContext();
    ctx.workspace.createFile.mockRejectedValueOnce("disk full");
    await open();

    await open();

    expect(ctx.navigation.openFile).toHaveBeenCalledWith(TODAY);
  });

  it("does not open the note of a workspace that was closed meanwhile", async () => {
    const { ctx, state, open } = fakeContext();
    ctx.workspace.createFile.mockImplementation(async () => {
      state.root = "/other";
      return { path: TODAY, created: true };
    });

    await open();

    expect(ctx.navigation.openFile).not.toHaveBeenCalled();
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  // createFile writes to whichever workspace is open when it is called.
  it("creates nothing in a workspace opened while the template was being read", async () => {
    const { ctx, state, open } = fakeContext({ settings: { template: "templates/daily.md" } });
    ctx.workspace.readFile.mockImplementation(async () => {
      state.root = "/other";
      return "# Template";
    });

    await open();

    expect(ctx.workspace.createFile).not.toHaveBeenCalled();
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("judges no settings of a workspace that was replaced while they loaded", async () => {
    const { ctx, state, open } = fakeContext();
    ctx.workspace.getSettings.mockImplementation(async () => {
      state.root = "/other";
      return { filenamePattern: "" };
    });

    await open();

    expect(ctx.workspace.createFile).not.toHaveBeenCalled();
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("reports no failure for a workspace that was closed meanwhile", async () => {
    const { ctx, state, open } = fakeContext();
    ctx.workspace.getSettings.mockImplementation(async () => {
      state.root = null;
      throw new Error("No workspace is open");
    });

    await open();

    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("refuses settings that would put the note under a hidden name", async () => {
    const { ctx, open } = fakeContext({ settings: { folder: ".journal" } });

    await open();

    expect(ctx.workspace.createFile).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith("problem.hiddenPath");
  });
});
