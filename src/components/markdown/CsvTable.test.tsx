import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CsvTable } from "./CsvTable";

describe("CsvTable", () => {
  it("renders a table with the first row as header", async () => {
    render(<CsvTable code={"name,age\nAlice,30"} delimiter="," />);
    expect(await screen.findByRole("columnheader", { name: "name" })).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "age" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Alice" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "30" })).toBeInTheDocument();
  });

  it("parses tab-separated values with the tab delimiter", async () => {
    render(<CsvTable code={"a\tb\n1\t2"} delimiter={"\t"} />);
    expect(await screen.findByRole("columnheader", { name: "a" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "1" })).toBeInTheDocument();
  });

  it("pads short rows so every row has the column count", async () => {
    const { container } = render(<CsvTable code={"a,b,c\n1,2"} delimiter="," />);
    await screen.findByRole("table");
    const bodyCells = container.querySelectorAll("tbody td");
    expect(bodyCells).toHaveLength(3);
  });

  it("falls back to a raw code block for empty input", async () => {
    const { container } = render(<CsvTable code={""} delimiter="," />);
    await waitFor(() => {
      expect(container.querySelector("table")).toBeNull();
      expect(container.querySelector("pre")).toBeTruthy();
    });
  });
});
