import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAiKey, loadAiKeys, setAiKey } from "./aiKeys";

describe("aiKeys", () => {
  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("getAiKey maps a missing key (null) to the empty string", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    expect(await getAiKey("claude")).toBe("");
    expect(invoke).toHaveBeenCalledWith("ai_key_get", { provider: "claude" });
  });

  it("getAiKey returns the stored value", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("sk-live");
    expect(await getAiKey("openai")).toBe("sk-live");
  });

  it("setAiKey forwards provider and value", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await setAiKey("claude", "sk-new");
    expect(invoke).toHaveBeenCalledWith("ai_key_set", { provider: "claude", value: "sk-new" });
  });

  it("loadAiKeys collects stored keys and skips empty ones", async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args) => {
      return (args as { provider: string }).provider === "claude" ? "sk-c" : null;
    });
    expect(await loadAiKeys()).toEqual({ claude: "sk-c" });
  });

  it("loadAiKeys tolerates a broken keychain and logs without the secret", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("keyring locked"));
    expect(await loadAiKeys()).toEqual({});
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
