import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TableComponent } from "./TableComponent";

describe("TableComponent", () => {
  it("wraps the table in a scroller, so wide columns stay reachable", () => {
    const { container } = render(
      <TableComponent>
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </TableComponent>,
    );
    const wrapper = container.querySelector(".markdown-table-wrapper");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.firstElementChild?.tagName).toBe("TABLE");
  });

  it("passes table attributes through", () => {
    const { container } = render(
      <TableComponent data-testid="t">
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </TableComponent>,
    );
    expect(container.querySelector("table")?.getAttribute("data-testid")).toBe("t");
  });
});
