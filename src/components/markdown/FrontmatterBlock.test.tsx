import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ParsedFrontmatter } from "@/lib/frontmatter";
import { FrontmatterBlock } from "./FrontmatterBlock";

function fm(over: Partial<ParsedFrontmatter> = {}): ParsedFrontmatter {
  return {
    title: undefined,
    author: undefined,
    date: undefined,
    tags: undefined,
    extra: [],
    ...over,
  } as ParsedFrontmatter;
}

describe("FrontmatterBlock", () => {
  it("renders nothing in the body when all fields are absent", () => {
    const { container } = render(<FrontmatterBlock data={fm()} />);
    expect(container.querySelectorAll("tr")).toHaveLength(0);
  });

  it("renders the title row when title is set", () => {
    render(<FrontmatterBlock data={fm({ title: "Hello" })} />);
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders author with the user icon", () => {
    const { container } = render(<FrontmatterBlock data={fm({ author: "Jane" })} />);
    expect(screen.getByText("Author")).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("renders date wrapped in a time element", () => {
    const { container } = render(<FrontmatterBlock data={fm({ date: "2026-01-01" })} />);
    expect(container.querySelector("time")?.textContent).toBe("2026-01-01");
  });

  it("renders each tag in the tags list", () => {
    render(<FrontmatterBlock data={fm({ tags: ["alpha", "beta"] })} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getAllByText("#")).toHaveLength(2);
  });

  it("omits the tags row when the tags array is empty", () => {
    render(<FrontmatterBlock data={fm({ tags: [] })} />);
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
  });

  it("renders extra key/value pairs in order", () => {
    render(
      <FrontmatterBlock
        data={fm({
          extra: [
            ["category", "notes"],
            ["status", "draft"],
          ],
        })}
      />,
    );
    expect(screen.getByText("category")).toBeInTheDocument();
    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
  });
});
