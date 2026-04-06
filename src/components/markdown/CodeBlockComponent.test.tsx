import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeBlockComponent } from "./CodeBlockComponent";

vi.mock("./MermaidDiagram", () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-diagram">{code}</div>,
}));

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
});
