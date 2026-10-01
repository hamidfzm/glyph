import { describe, expect, it } from "vitest";
import { hasMath } from "./mathPattern";

describe("hasMath", () => {
  it.each([
    ["inline dollars", "the area is $\\pi r^2$ here", true],
    ["a display block", "$$\nx + y\n$$", true],
    ["a \\( delimiter", "see \\(a\\)", true],
    ["a \\[ delimiter", "see \\[a\\]", true],
    ["plain prose", "no formulas at all", false],
    ["a lone price", "it costs $5", false],
    ["an escaped dollar pair", "from \\$5 to $10", false],
  ])("%s", (_, markdown, expected) => {
    expect(hasMath(markdown)).toBe(expected);
  });
});
