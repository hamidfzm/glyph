import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelfSaveTracker } from "./useSelfSaveTracker";

describe("useSelfSaveTracker", () => {
  it("counts the app's writes to each path separately", () => {
    const { result } = renderHook(() => useSelfSaveTracker());
    expect(result.current.selfSaveCount("/p/a.md")).toBe(0);

    result.current.markSelfSave("/p/a.md");
    result.current.markSelfSave("/p/a.md");
    result.current.markSelfSave("/p/b.md");

    expect(result.current.selfSaveCount("/p/a.md")).toBe(2);
    expect(result.current.selfSaveCount("/p/b.md")).toBe(1);
  });
});
