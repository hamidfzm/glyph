import { afterEach, beforeEach } from "vitest";

/**
 * Fails any test that produces console.error/console.warn output it did not
 * declare. Silent-failure logs and React act() warnings are real findings; a
 * test that intentionally exercises a failure path declares the output with
 * `expectConsole(/pattern/)` (or keeps its own console spy, which bypasses the
 * guard entirely).
 */
const METHODS = ["error", "warn"] as const;
type Method = (typeof METHODS)[number];

const originals: Record<Method, (...args: unknown[]) => void> = {
  error: console.error,
  warn: console.warn,
};

// Environment artifacts, not app behavior: happy-dom has no doctype (KaTeX
// warns on import), and react-dom's tag list predates the native <search>
// element SearchBar renders, warning once per run in whichever test renders
// it first (which breaks single-test filtered runs if declared per test).
const ENVIRONMENT_NOISE = [
  /KaTeX doesn't work in quirks mode/,
  /The tag <%s> is unrecognized in this browser.*\bsearch\b/s,
];

// Module-level state ties output to the currently running test, so this guard
// is incompatible with it.concurrent (none exists in the suite today).
let recorded: Array<{ method: Method; text: string }> = [];
let allowed: RegExp[] = [];

function format(arg: unknown): string {
  if (arg instanceof Error) return arg.message;
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/** Declare console output the current test intentionally triggers. */
export function expectConsole(...patterns: RegExp[]) {
  allowed.push(...patterns);
}

export function installConsoleGuard() {
  beforeEach(() => {
    recorded = [];
    allowed = [...ENVIRONMENT_NOISE];
    for (const method of METHODS) {
      console[method] = (...args: unknown[]) => {
        recorded.push({ method, text: args.map(format).join(" ") });
        originals[method](...args);
      };
    }
  });

  // Registered in the setup file, so with stack-ordered afterEach hooks this
  // runs after the test file's own hooks and Testing Library's cleanup, which
  // is what lets it catch unmount-time output too.
  afterEach(() => {
    for (const method of METHODS) {
      console[method] = originals[method];
    }
    const unexpected = recorded.filter((entry) => !allowed.some((p) => p.test(entry.text)));
    recorded = [];
    if (unexpected.length > 0) {
      const lines = unexpected.map((entry) => `console.${entry.method}: ${entry.text}`);
      throw new Error(
        "Unexpected console output. If intentional, declare it with " +
          `expectConsole(/pattern/) from @/test/consoleGuard:\n${lines.join("\n")}`,
      );
    }
  });
}
