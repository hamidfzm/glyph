import { describe, expect, it } from "vitest";
import { currentTable, renderTable, strippedRanges } from "./gen-slug-table.mjs";

describe("slug table", () => {
  it("strips exactly the code points github-slugger strips", () => {
    expect(currentTable(), "run node scripts/gen-slug-table.mjs").toBe(
      renderTable(strippedRanges()),
    );
  });
});
