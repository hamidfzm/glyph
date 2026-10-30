import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

// The listing is cached for the session, so each case loads a fresh module.
async function load() {
  vi.resetModules();
  return import("@/lib/ai/assistantTools");
}

const described = {
  name: "backlinks",
  title: "Backlinks",
  description: "Every note linking to this one.",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true },
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("assistantTools", () => {
  it("lists the tools once per session, as definitions a provider takes", async () => {
    mockInvoke.mockResolvedValue([described]);
    const { assistantTools } = await load();

    const tools = await assistantTools();
    await assistantTools();

    expect(tools).toEqual([
      {
        name: "backlinks",
        description: "Every note linking to this one.",
        inputSchema: { type: "object" },
      },
    ]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("assistant_tools");
  });

  it("offers no tools where the app has none to give, and asks again next time", async () => {
    mockInvoke.mockRejectedValueOnce("command assistant_tools not found");
    mockInvoke.mockResolvedValueOnce([described]);
    const { assistantTools } = await load();

    await expect(assistantTools()).resolves.toEqual([]);
    await expect(assistantTools()).resolves.toHaveLength(1);
  });
});

describe("runAssistantTool", () => {
  const call = { id: "c1", name: "read_note", input: { ref: "Cooking" } };

  it("runs a call for the active note's window and returns what the tool answered", async () => {
    mockInvoke.mockResolvedValue('{"content":"Recipes"}');
    const { runAssistantTool } = await load();

    await expect(runAssistantTool(call, "/ws/Index.md")).resolves.toEqual({
      callId: "c1",
      name: "read_note",
      content: '{"content":"Recipes"}',
      isError: false,
    });
    expect(mockInvoke).toHaveBeenCalledWith("assistant_tool_call", {
      name: "read_note",
      arguments: { ref: "Cooking" },
      activeNote: "/ws/Index.md",
    });
  });

  it("turns a refusal into a result the model reads", async () => {
    mockInvoke.mockRejectedValue("read_note is not in the vault");
    const { runAssistantTool } = await load();

    await expect(runAssistantTool(call, undefined)).resolves.toEqual({
      callId: "c1",
      name: "read_note",
      content: "read_note is not in the vault",
      isError: true,
    });
  });
});
