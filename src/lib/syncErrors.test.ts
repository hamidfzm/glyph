import { describe, expect, it } from "vitest";
import { i18n } from "@/lib/i18n";
import { describeSyncError } from "./syncErrors";

describe("describeSyncError", () => {
  const t = i18n.getFixedT("en", "sync");

  it("renders one sentence per tagged variant", () => {
    expect(describeSyncError({ kind: "not-configured" }, t)).toMatch(/isn't configured/);
    expect(describeSyncError({ kind: "auth-failed", message: "bad token" }, t)).toMatch(
      /Authentication failed: bad token/,
    );
    expect(describeSyncError({ kind: "auth-failed" }, t)).toMatch(/Authentication failed\./);
    expect(describeSyncError({ kind: "network", message: "timeout" }, t)).toMatch(/Couldn't reach/);
    expect(describeSyncError({ kind: "network" }, t)).toMatch(/Couldn't reach the remote\./);
    expect(describeSyncError({ kind: "conflict", message: ["a", "b"] }, t)).toMatch(
      /Resolve conflicts in 2 file/,
    );
    expect(describeSyncError({ kind: "conflict" }, t)).toMatch(/Resolve conflicts in 0 file/);
    expect(describeSyncError({ kind: "invalid-state", message: "detached" }, t)).toMatch(
      /unexpected state: detached/,
    );
    expect(describeSyncError({ kind: "invalid-state" }, t)).toMatch(/unexpected state\./);
    expect(describeSyncError({ kind: "io", message: "no space" }, t)).toMatch(
      /I\/O error: no space/,
    );
    expect(describeSyncError({ kind: "io" }, t)).toMatch(/I\/O error\./);
    expect(describeSyncError({ kind: "backend", message: "libgit2 boom" }, t)).toMatch(
      /backend error: libgit2 boom/,
    );
    expect(describeSyncError({ kind: "backend" }, t)).toMatch(/backend error\./);
  });

  it("handles unknown or non-object inputs", () => {
    // null and undefined both fall through the `!err` guard and pick up the fallback.
    expect(describeSyncError(null, t)).toMatch(/Unknown sync error/);
    expect(describeSyncError(undefined, t)).toMatch(/Unknown sync error/);
    expect(describeSyncError("oops", t)).toBe("oops");
    // Tagged variant we don't recognise still gets a fallback.
    expect(describeSyncError({ kind: "not-a-thing" } as unknown, t)).toMatch(/Unknown sync error/);
  });
});
