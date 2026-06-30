import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type { FencedRendererContribution } from "@/lib/plugins/types";
import { CodeBlockComponent } from "./CodeBlockComponent";

vi.mock("./MermaidDiagram", () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-diagram">{code}</div>,
}));

const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: writeTextMock },
  configurable: true,
});

describe("CodeBlockComponent", () => {
  it("renders a normal pre element for non-mermaid code", () => {
    const { container } = render(
      <CodeBlockComponent>
        <code className="language-javascript">const x = 1;</code>
      </CodeBlockComponent>,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
  });

  it("renders a plugin-registered fenced language with its component", () => {
    const fencedRenderers = createRegistry<FencedRendererContribution>();
    fencedRenderers.register({
      language: "d2",
      render: ({ code }) => <div data-testid="d2">{code}</div>,
    });
    render(
      <PluginsContext.Provider value={{ fencedRenderers } as unknown as PluginsContextValue}>
        <CodeBlockComponent>
          <code className="language-d2">a -&gt; b</code>
        </CodeBlockComponent>
      </PluginsContext.Provider>,
    );
    expect(screen.getByTestId("d2").textContent).toBe("a -> b");
  });

  it("renders MermaidDiagram for mermaid code blocks", () => {
    render(
      <CodeBlockComponent>
        <code className="language-mermaid">graph TD; A--&gt;B;</code>
      </CodeBlockComponent>,
    );
    expect(screen.getByTestId("mermaid-diagram")).toBeInTheDocument();
  });

  it("passes code content to MermaidDiagram", () => {
    render(
      <CodeBlockComponent>
        <code className="language-mermaid">graph LR; A--&gt;B;</code>
      </CodeBlockComponent>,
    );
    expect(screen.getByTestId("mermaid-diagram")).toHaveTextContent("graph LR; A-->B;");
  });

  it("renders a CSV table for csv code blocks", () => {
    render(
      <CodeBlockComponent>
        <code className="language-csv">{"name,age\nAlice,30"}</code>
      </CodeBlockComponent>,
    );
    expect(screen.getByRole("columnheader", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alice" })).toBeInTheDocument();
  });

  it("renders a table for tsv code blocks", () => {
    render(
      <CodeBlockComponent>
        <code className="language-tsv">{"a\tb\n1\t2"}</code>
      </CodeBlockComponent>,
    );
    expect(screen.getByRole("columnheader", { name: "a" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument();
  });

  it("does not render a copy button for csv blocks", () => {
    render(
      <CodeBlockComponent>
        <code className="language-csv">{"a,b\n1,2"}</code>
      </CodeBlockComponent>,
    );
    expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
  });

  it("renders pre when children is not a valid element", () => {
    const { container } = render(<CodeBlockComponent>plain text</CodeBlockComponent>);
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe("plain text");
  });

  it("renders pre when code has no className", () => {
    const { container } = render(
      <CodeBlockComponent>
        <code>some code</code>
      </CodeBlockComponent>,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
  });

  it("preserves extra pre props", () => {
    const { container } = render(
      <CodeBlockComponent className="custom-pre">
        <code>test</code>
      </CodeBlockComponent>,
    );
    const pre = container.querySelector("pre");
    expect(pre?.className).toBe("custom-pre");
  });

  describe("copy button", () => {
    it("renders a copy button for code blocks", () => {
      render(
        <CodeBlockComponent>
          <code className="language-javascript">const x = 1;</code>
        </CodeBlockComponent>,
      );
      expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
    });

    it("does not render a copy button for mermaid blocks", () => {
      render(
        <CodeBlockComponent>
          <code className="language-mermaid">graph TD; A--&gt;B;</code>
        </CodeBlockComponent>,
      );
      expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
    });

    it("does not render a copy button when code is empty", () => {
      render(
        <CodeBlockComponent>
          <code className="language-javascript">{""}</code>
        </CodeBlockComponent>,
      );
      expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
    });

    afterEach(() => {
      writeTextMock.mockClear();
    });

    it("copies code text to clipboard on click", async () => {
      render(
        <CodeBlockComponent>
          <code className="language-javascript">const x = 1;</code>
        </CodeBlockComponent>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      await vi.waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("const x = 1;");
      });
    });

    it("shows copied feedback after clicking", async () => {
      render(
        <CodeBlockComponent>
          <code className="language-javascript">const x = 1;</code>
        </CodeBlockComponent>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
      });
    });

    it("reverts to copy icon after timeout", async () => {
      vi.useFakeTimers();

      render(
        <CodeBlockComponent>
          <code className="language-javascript">const x = 1;</code>
        </CodeBlockComponent>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
      vi.useRealTimers();
    });

    it("restarts the revert timer when copied again before it fires", async () => {
      vi.useFakeTimers();

      render(
        <CodeBlockComponent>
          <code className="language-javascript">const x = 1;</code>
        </CodeBlockComponent>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
      });

      // Copy again while the 2s revert timer is still pending: the existing
      // timer is cleared and restarted, so the button stays in "Copied".
      fireEvent.click(screen.getByRole("button", { name: "Copied" }));
      await vi.waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

      vi.useRealTimers();
    });

    it("wraps pre in a code-block-wrapper div", () => {
      const { container } = render(
        <CodeBlockComponent>
          <code className="language-javascript">const x = 1;</code>
        </CodeBlockComponent>,
      );
      const wrapper = container.querySelector(".code-block-wrapper");
      expect(wrapper).toBeTruthy();
      expect(wrapper?.querySelector("pre")).toBeTruthy();
    });
  });
});
