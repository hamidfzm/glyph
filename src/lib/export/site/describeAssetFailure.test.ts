import { describe, expect, it } from "vitest";
import { describeAssetFailure } from "./describeAssetFailure";

describe("describeAssetFailure", () => {
  it("quotes the site path and says why the copy failed", () => {
    expect(describeAssetFailure("guide/shot.png", "os error 2")).toBe(
      '"guide/shot.png": os error 2',
    );
  });

  it("escapes what a name or a reason could do to a terminal", () => {
    // Numbers are code points, so the source holds none of them as written.
    const text = (...parts: (string | number)[]) =>
      parts.map((part) => (typeof part === "number" ? String.fromCodePoint(part) : part)).join("");
    // A note picks the name: a control sequence, a text-direction override
    // and a line break that would start a line of its own.
    const name = text("evil", 0x9b, "2J", 0x202e, '"', 0x0a, ".png");
    const reason = text("denied: ", 0x1b, "[2Jevil", 0x2028, ".png");

    expect(describeAssetFailure(name, reason)).toBe(
      String.raw`"evil\u{9b}2J\u{202e}\"\n.png": denied: \u{1b}[2Jevil\u{2028}.png`,
    );
  });
});
