import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAiKey, loadAiKeys, setAiKey } from "./aiKeys";

describe("aiKeys", () => {
  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("getAiKey reads the provider's namespaced secret", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    expect(await getAiKey("claude")).toBe("");
    expect(invoke).toHaveBeenCalledWith("secret_get", { name: "ai-api-key-claude" });
  });

  it("setAiKey writes the provider's namespaced secret", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await setAiKey("openai", "sk-new");
    expect(invoke).toHaveBeenCalledWith("secret_set", {
      name: "ai-api-key-openai",
      value: "sk-new",
    });
  });

  it("loadAiKeys collects stored keys and skips empty ones", async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args) => {
      return (args as { name: string }).name === "ai-api-key-claude" ? "sk-c" : null;
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
