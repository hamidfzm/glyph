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

  it("turns individual attributes off (22/23/24)", () => {
    // bold on then off, italic on then off, underline on then off.
    const segs = parseAnsi(`${ESC}[1mB${ESC}[22mb${ESC}[3mI${ESC}[23mi${ESC}[4mU${ESC}[24mu`);
    expect(segs[0].classes).toEqual(["ansi-bold"]);
    expect(segs[1].classes).toEqual([]);
    expect(segs[2].classes).toEqual(["ansi-italic"]);
    expect(segs[3].classes).toEqual([]);
    expect(segs[4].classes).toEqual(["ansi-underline"]);
    expect(segs[5].classes).toEqual([]);
  });

  it("resets foreground (39) and background (49) to default", () => {
    const segs = parseAnsi(`${ESC}[31;41mx${ESC}[39my${ESC}[49mz`);
    expect(segs[0].classes).toEqual(["ansi-fg-red", "ansi-bg-red"]);
    expect(segs[1].classes).toEqual(["ansi-bg-red"]); // fg cleared, bg kept
    expect(segs[2].classes).toEqual([]); // bg cleared too
  });

  it("maps a standard background colour class", () => {
    const segs = parseAnsi(`${ESC}[42mx`);
    expect(segs[0].classes).toContain("ansi-bg-green");
  });

  it("maps the low (n<16) range of the 256-colour palette", () => {
    // 38;5;0 → black, 38;5;9 → bright red, from the fixed 16-entry base table.
    expect(parseAnsi(`${ESC}[38;5;0mx`)[0].style.color).toBe("#000000");
    expect(parseAnsi(`${ESC}[38;5;9mx`)[0].style.color).toBe("#ff0000");
  });

  it("maps a mid-range (16-231) 256-colour cube index", () => {
    // 16 is the first cube entry → pure black corner of the 6x6x6 cube.
    expect(parseAnsi(`${ESC}[38;5;16mx`)[0].style.color).toBe("#000000");
    // 231 is the last cube entry → white corner.
    expect(parseAnsi(`${ESC}[38;5;231mx`)[0].style.color).toBe("#ffffff");
  });

  it("clamps out-of-range 256-colour indices", () => {
    // idx > 255 is clamped to 255 (greyscale white-ish), idx missing → 0.
    expect(parseAnsi(`${ESC}[38;5;999mx`)[0].style.color).toBe("#eeeeee");
    expect(parseAnsi(`${ESC}[38;5mx`)[0].style.color).toBe("#000000");
  });

  it("defaults missing truecolour components to 0", () => {
    // 38;2 with no r/g/b → rgb(0, 0, 0) via the `?? 0` fallbacks.
    expect(parseAnsi(`${ESC}[38;2mx`)[0].style.color).toBe("rgb(0, 0, 0)");
    // 48;2 background truecolour with only red supplied → green/blue default 0.
    expect(parseAnsi(`${ESC}[48;2;7mx`)[0].style.backgroundColor).toBe("rgb(7, 0, 0)");
  });

  it("ignores an extended-colour code with an unknown mode", () => {
    // 38;9 — mode 9 is neither 5 nor 2, so no colour is applied.
    const segs = parseAnsi(`${ESC}[38;9mx`);
    expect(segs[0].style.color).toBeUndefined();
  });

  it("ignores unknown SGR codes without affecting styling", () => {
    // 5 (blink) and 7 (reverse) are intentionally unhandled.
    const segs = parseAnsi(`${ESC}[5;7mx`);
    expect(segs[0].classes).toEqual([]);
    expect(segs[0].style).toEqual({});
  });
});
