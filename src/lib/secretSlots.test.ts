import { describe, expect, it } from "vitest";
import { KEYED_PROVIDERS } from "@/lib/aiKeys";
import { presenceStatusKey, SECRET_SLOTS, slotLabelKey } from "@/lib/secretSlots";

describe("secretSlots", () => {
  it("enumerates one slot per keyed provider plus the sync token", () => {
    expect(SECRET_SLOTS).toHaveLength(KEYED_PROVIDERS.length + 1);
    expect(SECRET_SLOTS.map((s) => s.id)).toEqual([
      ...KEYED_PROVIDERS.map((p) => `ai-${p}`),
      "sync-token",
    ]);
  });

  it("gives every slot a distinct label key", () => {
    const keys = SECRET_SLOTS.map(slotLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("secrets.slots.syncToken");
  });

  it("keeps an unknown presence out of the 'not set' bucket", () => {
    expect(presenceStatusKey(null)).toBe("secrets.status.unknown");
    expect(presenceStatusKey(false)).toBe("secrets.status.notSet");
    expect(presenceStatusKey(true)).toBe("secrets.status.saved");
  });
});
