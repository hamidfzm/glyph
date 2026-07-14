import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSecret, setSecret } from "./secrets";

describe("secrets", () => {
  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("getSecret maps a missing entry (null) to the empty string", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    expect(await getSecret("ai-api-key-claude")).toBe("");
    expect(invoke).toHaveBeenCalledWith("secret_get", { name: "ai-api-key-claude" });
  });

  it("getSecret returns the stored value", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("s3cret");
    expect(await getSecret("ai-api-key-openai")).toBe("s3cret");
  });

  it("setSecret forwards name and value", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await setSecret("ai-api-key-claude", "sk-new");
    expect(invoke).toHaveBeenCalledWith("secret_set", {
      name: "ai-api-key-claude",
      value: "sk-new",
    });
  });
});
