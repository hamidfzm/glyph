import { type ParsedAccelerator, parseAccelerator } from "@/lib/accelerator";
import { BINDABLE_COMMANDS } from "@/lib/bindableCommands";

// Merging default bindings with the user's overrides, and spotting two commands
// that ended up on the same accelerator.

export type BindingOverrides = Record<string, string>;

/** Merge default bindings with user overrides into a id -> accelerator map. */
export function resolveBindings(overrides: BindingOverrides = {}): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const command of BINDABLE_COMMANDS) {
    const override = overrides[command.id];
    resolved.set(
      command.id,
      override && override.length > 0 ? override : command.defaultAccelerator,
    );
  }
  return resolved;
}

/** Returns a set of command ids that share an accelerator with another command.
 *  Accelerators are compared in canonical (parsed) form so "Cmd+O" and
 *  "CmdOrCtrl+o" collide. */
export function findConflicts(resolved: Map<string, string>): Set<string> {
  const byCanonical = new Map<string, string[]>();
  for (const [id, accel] of resolved) {
    const parsed = parseAccelerator(accel);
    if (!parsed) continue;
    const canonical = canonicalKey(parsed);
    const ids = byCanonical.get(canonical) ?? [];
    ids.push(id);
    byCanonical.set(canonical, ids);
  }
  const conflicts = new Set<string>();
  for (const ids of byCanonical.values()) {
    if (ids.length > 1) for (const id of ids) conflicts.add(id);
  }
  return conflicts;
}

function canonicalKey(parsed: ParsedAccelerator): string {
  return [
    parsed.cmdOrCtrl ? "M" : "",
    parsed.alt ? "A" : "",
    parsed.shift ? "S" : "",
    parsed.key,
  ].join("|");
}
