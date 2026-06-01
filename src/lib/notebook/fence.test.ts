import { describe, expect, it } from "vitest";
import { fenceCode } from "./fence";

describe("fenceCode", () => {
  it("wraps plain source in a triple-backtick fence with the language", () => {
    expect(fenceCode("x = 1", "python")).toBe("```python\nx = 1\n```");
  });

  it("grows the fence longer than any backtick run in the source", () => {
    // Source contains a ``` run, so the fence must be at least ````.
    const out = fenceCode("a\n```\nb", "json");
    expect(out.startsWith("````json\n")).toBe(true);
    expect(out.endsWith("\n````")).toBe(true);
  });

  it("handles source with a longer backtick run", () => {
    const out = fenceCode("````", "text");
    expect(out.startsWith("`````text\n")).toBe(true);
    expect(out.endsWith("\n`````")).toBe(true);
  });

  it("uses an empty language tag when none is meaningful", () => {
    expect(fenceCode("plain", "")).toBe("```\nplain\n```");
  });
});
