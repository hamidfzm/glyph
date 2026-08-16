import { describe, expect, it } from "vitest";
import { KEYED_PROVIDERS } from "@/lib/aiKeys";
import { presenceStatusKey, SECRET_SLOTS, slotLabelKey } from "@/lib/secretSlots";

describe("secretSlots", () => {
  // The Cloud Sync token is keyed by workspace path, so it is managed in that
  // workspace's Sync settings tab rather than in this app-wide list.
  it("enumerates one slot per keyed provider and nothing per-workspace", () => {
    expect(SECRET_SLOTS.map((s) => s.id)).toEqual(KEYED_PROVIDERS.map((p) => `ai-${p}`));
  });

  it("gives every slot a distinct label key", () => {
    const keys = SECRET_SLOTS.map(slotLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps an unchecked or unknown presence out of the 'not set' bucket", () => {
    expect(presenceStatusKey(undefined)).toBe("secrets.status.checking");
    expect(presenceStatusKey(null)).toBe("secrets.status.unknown");
    expect(presenceStatusKey(false)).toBe("secrets.status.notSet");
    expect(presenceStatusKey(true)).toBe("secrets.status.saved");
  });
});
