import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

describe("base64", () => {
  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("encodes UTF-8 bytes beyond Latin-1", () => {
    expect(bytesToBase64(new TextEncoder().encode("سلام"))).toBe("2LPZhNin2YU=");
  });

  it("throws on input that is not base64", () => {
    expect(() => base64ToBytes("not base64!")).toThrow();
  });
});
