import { describe, expect, it } from "vitest";
import { rehypeSourceLines } from "./rehypeSourceLines";

interface TestNode {
  type: string;
  position?: { start: { line: number } };
  properties?: Record<string, unknown>;
  children?: TestNode[];
}

function block(type: string, line?: number, properties?: Record<string, unknown>): TestNode {
  return {
    type,
    properties,
    position: line === undefined ? undefined : { start: { line } },
  };
}

function run(children: TestNode[]) {
  rehypeSourceLines()({ children });
  return children;
}

describe("rehypeSourceLines", () => {
  it("stamps each top-level element with its source line", () => {
    const [heading, paragraph] = run([block("element", 1), block("element", 7)]);
    expect(heading.properties?.["data-line"]).toBe("1");
    expect(paragraph.properties?.["data-line"]).toBe("7");
  });

  it("keeps the properties a node already had", () => {
    const [node] = run([block("element", 3, { className: ["alert"] })]);
    expect(node.properties?.className).toEqual(["alert"]);
    expect(node.properties?.["data-line"]).toBe("3");
  });

  it("skips non-element nodes", () => {
    const [text] = run([block("text", 2)]);
    expect(text.properties).toBeUndefined();
  });

  it("skips elements with no position, as generated nodes have none", () => {
    const [node] = run([block("element")]);
    expect(node.properties?.["data-line"]).toBeUndefined();
  });

  it("does not descend into children, since only top-level blocks are anchors", () => {
    const child = block("element", 4);
    const parent: TestNode = {
      type: "element",
      position: { start: { line: 2 } },
      children: [child],
    };
    run([parent]);
    expect(child.properties?.["data-line"]).toBeUndefined();
  });

  it("tolerates a tree with no children", () => {
    expect(() => rehypeSourceLines()({})).not.toThrow();
  });
});
