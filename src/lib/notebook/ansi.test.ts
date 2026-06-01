import { describe, expect, it } from "vitest";
import { hasAnsi, parseAnsi } from "./ansi";

const ESC = "\x1b";

describe("parseAnsi", () => {
  it("returns a single plain segment for text with no codes", () => {
    const segs = parseAnsi("hello world");
    expect(segs).toEqual([{ text: "hello world", classes: [], style: {} }]);
  });

  it("applies a named foreground colour class", () => {
    const segs = parseAnsi(`${ESC}[31mred${ESC}[0m`);
    expect(segs[0]).toEqual({ text: "red", classes: ["ansi-fg-red"], style: {} });
  });

  it("clears styling on reset", () => {
    const segs = parseAnsi(`${ESC}[1;32mok${ESC}[0m done`);
    expect(segs[0].classes).toEqual(["ansi-bold", "ansi-fg-green"]);
    expect(segs[1]).toEqual({ text: " done", classes: [], style: {} });
  });

  it("handles bright foreground and background colours", () => {
    const segs = parseAnsi(`${ESC}[91;100mx`);
    expect(segs[0].classes).toContain("ansi-fg-bright-red");
    expect(segs[0].classes).toContain("ansi-bg-bright-black");
  });

  it("maps 256-colour foreground to an inline hex colour", () => {
    const segs = parseAnsi(`${ESC}[38;5;196mx`);
    expect(segs[0].style.color).toBe("#ff0000");
  });

  it("maps truecolour to an inline rgb colour", () => {
    const segs = parseAnsi(`${ESC}[38;2;10;20;30mx`);
    expect(segs[0].style.color).toBe("rgb(10, 20, 30)");
  });

  it("maps a 256-colour background to an inline hex backgroundColor", () => {
    const segs = parseAnsi(`${ESC}[48;5;21mx`);
    expect(segs[0].style.backgroundColor).toBe("#0000ff");
  });

  it("maps a truecolour background to an inline rgb backgroundColor", () => {
    const segs = parseAnsi(`${ESC}[48;2;1;2;3mx`);
    expect(segs[0].style.backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("maps the 232+ greyscale ramp of the 256-colour palette", () => {
    const segs = parseAnsi(`${ESC}[38;5;232mx`);
    expect(segs[0].style.color).toBe("#080808");
  });

  it("applies italic and underline attributes", () => {
    const segs = parseAnsi(`${ESC}[3;4mx`);
    expect(segs[0].classes).toContain("ansi-italic");
    expect(segs[0].classes).toContain("ansi-underline");
  });

  it("treats a bare ESC[m as a reset", () => {
    const segs = parseAnsi(`${ESC}[31ma${ESC}[mb`);
    expect(segs[0].classes).toEqual(["ansi-fg-red"]);
    expect(segs[1].classes).toEqual([]);
  });

  it("strips non-SGR CSI sequences without emitting style", () => {
    const segs = parseAnsi(`a${ESC}[2Kb`);
    expect(segs.map((s) => s.text).join("")).toBe("ab");
  });

  it("detects presence of ANSI codes", () => {
    expect(hasAnsi(`${ESC}[31mx`)).toBe(true);
    expect(hasAnsi("plain")).toBe(false);
  });
});
