import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSiteConfigForm } from "./useSiteConfigForm";

vi.mock("@tauri-apps/api/core");

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useSiteConfigForm", () => {
  // The tab can render before a workspace is open; saving then would have no
  // directory to write `.glyph/site.json` into.
  it("refuses to save without a workspace, and writes nothing", async () => {
    const { result } = renderHook(() => useSiteConfigForm(undefined));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
