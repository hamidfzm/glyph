import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolCallView } from "@/lib/ai/chatTurn";
import { MAX_SHOWN_CHARS } from "@/lib/ai/toolCallDisplay";
import strings from "@/locales/en/ai.json";
import { AIToolCall } from "./AIToolCall";

// A summary click opens the details and queues its toggle event, which is
// what the component listens to, so a test waits for the change.
function toggle(name: RegExp) {
  const summary = screen.getByText(name).closest("summary");
  if (!summary) throw new Error("no summary");
  fireEvent.click(summary);
}

// The tools the Rust registry offers the assistant: `mcp::tests` holds the
// registry to the same file, so a tool added there without a label fails here.
const READ_TOOLS: string[] = JSON.parse(
  readFileSync(path.join(process.cwd(), "src-tauri", "fixtures", "mcp-read-tools.json"), "utf-8"),
);

const view = (overrides: Partial<ToolCallView> = {}): ToolCallView => ({
  key: 0,
  call: { id: "c1", name: "backlinks", input: { ref: "Cooking" } },
  status: "done",
  result: '{"path":"Notes/Cooking.md","backlinks":{"total":2}}',
  ...overrides,
});

describe("AIToolCall", () => {
  it("names every tool the assistant is offered", () => {
    expect(Object.keys(strings.tools.names)).toEqual(READ_TOOLS);
  });

  it("is collapsed to the tool and what it was about", () => {
    render(<AIToolCall view={view()} />);
    expect(screen.getByText("Backlinks")).toBeInTheDocument();
    expect(screen.getByText("Cooking")).toBeInTheDocument();
    expect(screen.queryByText(/"total": 2/)).not.toBeInTheDocument();
  });

  it("shows what the call asked for and what came back once opened", async () => {
    render(<AIToolCall view={view()} />);
    toggle(/Backlinks/);
    expect(await screen.findByText("Asked for")).toBeInTheDocument();
    expect(screen.getByText(/"ref": "Cooking"/)).toBeInTheDocument();
    expect(screen.getByText(/"total": 2/)).toBeInTheDocument();

    toggle(/Backlinks/);
    await waitFor(() => expect(screen.queryByText("Asked for")).not.toBeInTheDocument());
  });

  it("says when a call failed, was stopped, or is still running", () => {
    const { rerender } = render(
      <AIToolCall view={view({ status: "failed", result: "not in the vault" })} />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    rerender(<AIToolCall view={view({ status: "stopped", result: undefined })} />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    rerender(<AIToolCall view={view({ status: "running", result: undefined })} />);
    expect(screen.getByText("Reading…")).toBeInTheDocument();
  });

  it("shows a tool name the model made up as it was sent", () => {
    render(<AIToolCall view={view({ call: { id: "x", name: "delete_vault", input: {} } })} />);
    expect(screen.getByText("delete_vault")).toBeInTheDocument();
  });

  it("warns, without being opened, when the result came from an incomplete index", () => {
    const status = { truncated: true, reason: "fileLimit", limit: 20000 };
    render(<AIToolCall view={view({ result: JSON.stringify({ status }) })} />);
    expect(screen.getByText(/only the first 20000 documents were indexed/)).toBeInTheDocument();
  });

  it("says how much of a long result it shows", async () => {
    const long = JSON.stringify("x".repeat(MAX_SHOWN_CHARS + 10));
    render(<AIToolCall view={view({ result: long })} />);
    toggle(/Backlinks/);
    expect(
      await screen.findByText(
        `Showing the first ${MAX_SHOWN_CHARS} of ${long.length} characters.`,
        {
          exact: false,
        },
      ),
    ).toBeInTheDocument();
  });
});
