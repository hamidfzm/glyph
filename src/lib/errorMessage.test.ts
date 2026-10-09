import { describe, expect, it } from "vitest";
import { errorMessage } from "./errorMessage";

describe("errorMessage", () => {
  it("reads the message off an Error", () => {
    expect(errorMessage(new Error("disk full"))).toBe("disk full");
  });

  it("keeps the string a rejected command threw", () => {
    expect(errorMessage("Failed to write file: os error 5")).toBe(
      "Failed to write file: os error 5",
    );
  });

  it("still yields text for a value that is neither", () => {
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
