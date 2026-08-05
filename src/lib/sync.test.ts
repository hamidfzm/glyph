import { describe, expect, it } from "vitest";
import { defaultConfigFor } from "./sync";

describe("defaultConfigFor", () => {
  it("fills in sensible defaults for a fresh workspace", () => {
    const cfg = defaultConfigFor("/workspace");
    expect(cfg.workspacePath).toBe("/workspace");
    expect(cfg.backend).toBe("git");
    expect(cfg.remoteUrl).toBe("");
    expect(cfg.remoteBranch).toBe("main");
    expect(cfg.conflictPolicy).toBe("prompt");
    expect(cfg.author).toBeNull();
  });
});
