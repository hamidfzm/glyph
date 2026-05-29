import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CsvTable } from "./CsvTable";

describe("CsvTable", () => {
  it("renders a table with the first row as header", () => {
    render(<CsvTable code={"name,age\nAlice,30"} delimiter="," />);
    expect(screen.getByRole("columnheader", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "age" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alice" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "30" })).toBeInTheDocument();
  });

  it("parses tab-separated values with the tab delimiter", () => {
    render(<CsvTable code={"a\tb\n1\t2"} delimiter={"\t"} />);
    expect(screen.getByRole("columnheader", { name: "a" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument();
  });

  it("pads short rows so every row has the column count", () => {
    const { container } = render(<CsvTable code={"a,b,c\n1,2"} delimiter="," />);
    const bodyCells = container.querySelectorAll("tbody td");
    expect(bodyCells).toHaveLength(3);
  });

  it("falls back to a raw code block for empty input", () => {
    const { container } = render(<CsvTable code={""} delimiter="," />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("pre")).toBeTruthy();
  });
});
