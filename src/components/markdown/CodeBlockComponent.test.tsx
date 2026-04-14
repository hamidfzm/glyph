import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
