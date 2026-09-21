import { describe, expect, it } from "vitest";
import { parseHostMessage } from "./hostMessage";

describe("parseHostMessage", () => {
  it("reads a document message", () => {
    expect(
      parseHostMessage({ kind: "document", content: "# Hi", baseUrl: "https://doc.example/" }),
    ).toEqual({ kind: "document", content: "# Hi", baseUrl: "https://doc.example/" });
  });

  it("reads a size notice", () => {
    expect(parseHostMessage({ kind: "tooLarge", bytes: 4096 })).toEqual({
      kind: "tooLarge",
      bytes: 4096,
    });
  });

  it("reads an unreadable notice", () => {
    expect(parseHostMessage({ kind: "unreadable" })).toEqual({ kind: "unreadable" });
  });

  it("rejects anything else", () => {
    for (const data of [
      null,
      "document",
      42,
      {},
      { kind: "other" },
      { kind: "document", content: "# Hi" },
      { kind: "document", content: 1, baseUrl: "https://doc.example/" },
      { kind: "tooLarge" },
      { kind: "tooLarge", bytes: "4096" },
    ]) {
      expect(parseHostMessage(data)).toBeNull();
    }
  });
});
