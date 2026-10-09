import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  APP_ENV,
  deleteSession,
  execute,
  newSession,
  resolveBinary,
  startDriver,
  waitFor,
} from "./harness.ts";

// Built-app smoke: launches the real binary over WebDriver (tauri-driver) and
// checks the things unit tests cannot see, because they need a real process
// launch under the production CSP: a CLI-arg document renders (cold start,
// commit 5714293 / #494), the editor is laid out on screen and holds the
// document under the production CSP (#390), a second launch reuses the
// running window (#189, #494), and a launch naming several files opens every
// supported one (#881). `pnpm test:app`; CI runs it on Linux under xvfb (see
// .github/actions/app-smoke). Needs a release binary: the single-instance
// plugin is release-only (lib.rs), so a --debug build cannot exercise the
// second-instance cases.

// macOS has no WebKit WebDriver, so tauri-driver cannot drive it there.
const skip = process.platform === "darwin" ? "no WebKit WebDriver on macOS" : false;

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const ALPHA = fixture("alpha.md");
const BETA = fixture("beta.md");
const GAMMA = fixture("gamma.md");
const DELTA = fixture("delta.md");
const EPSILON = fixture("epsilon.md");
const ZETA = fixture("zeta.md");
// A type Glyph refuses to open. The Linux desktop entry lists text/plain, so a
// file manager can hand one over beside the markdown files.
const UNSUPPORTED = fixture("unsupported.txt");

let driver: ChildProcess;
let session: string;

const renderedHeading = () =>
  execute<string>(session, "return document.querySelector('.markdown-body h1')?.textContent ?? ''");

/** File names of the open tabs, in strip order (each tab's title is its path). */
const openTabs = () =>
  execute<string[]>(
    session,
    "return Array.from(document.querySelectorAll('.tab-item'), (tab) => tab.title.split(/[\\\\/]/).pop())",
  );

/**
 * Launch Glyph again while the first instance is running. The single-instance
 * plugin makes that process hand its arguments to the running app and exit;
 * resolves to its exit code.
 */
function launchAgain(command: string, args: string[]): Promise<number | null> {
  const second = spawn(command, args, { stdio: "ignore", env: APP_ENV });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error("second instance did not exit within 10s"));
    }, 10_000);
    second.on("error", reject);
    second.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
}

before(
  async () => {
    if (skip) return;
    driver = await startDriver();
    // A cold start naming several paths. The unsupported one comes first on
    // purpose: it used to sink the whole launch, and only the first supported
    // path ever opened.
    session = await newSession(resolveBinary(), [UNSUPPORTED, GAMMA, ALPHA]);
  },
  { timeout: 60_000 },
);

after(async () => {
  try {
    if (session) await deleteSession(session);
  } finally {
    driver?.kill();
  }
});

test("opens every supported file passed as a CLI argument", { skip }, async () => {
  // The last one named ends up active, so its heading is the one rendered.
  await waitFor("the alpha heading to render", async () => {
    return (await renderedHeading()).trim() === "Alpha smoke document";
  });
  assert.deepEqual(await openTabs(), ["gamma.md", "alpha.md"]);
});

test("edit mode shows the document in the editor", { skip }, async () => {
  // Click the toggle rather than sending Ctrl+E: on Linux that accelerator
  // belongs to the native GTK menu, which synthesized WebDriver key events
  // may never reach.
  await execute(session, "document.querySelector('button[aria-label=\"Edit mode\"]').click()");
  await waitFor("the editor to show the alpha body", async () => {
    const text = await execute<string>(
      session,
      "return document.querySelector('.cm-content')?.textContent ?? ''",
    );
    return text.includes("Alpha body line one.");
  });
  // #390's failure mode: the CSP blocked CodeMirror's injected stylesheet, so
  // the content existed in the DOM but was laid out thousands of pixels below
  // the fold. The text check alone passes on that broken build; only layout
  // proves the injected styles applied. Glyph's own CSS never sets display on
  // .cm-editor, so flex can only come from CodeMirror's injected base theme.
  const editorDisplay = await execute<string>(
    session,
    "return getComputedStyle(document.querySelector('.cm-editor')).display",
  );
  assert.equal(editorDisplay, "flex", "CodeMirror's injected stylesheet did not apply (CSP?)");
  // Bound against the configured window height (tauri.conf.json, 720):
  // window.innerHeight reports 0 under xvfb for the hidden-then-revealed
  // window, and a healthy build puts the editor right under the tab bar
  // (top ~168 in CI) while the broken build measured ~6400.
  const contentTop = await execute<number>(
    session,
    "return document.querySelector('.cm-content').getBoundingClientRect().top",
  );
  assert.ok(
    contentTop >= 0 && contentTop < 720,
    `.cm-content is laid out off-screen (top ${contentTop})`,
  );
});

test("a second instance opens its file in the running window", { skip }, async () => {
  // If the second process opened its own window instead of handing BETA over,
  // this session (attached to the first window) would keep showing ALPHA and
  // the two tabs it started with.
  assert.equal(await launchAgain(resolveBinary(), [BETA]), 0);

  await waitFor("the beta heading to render in the same window", async () => {
    return (await renderedHeading()).trim() === "Beta smoke document";
  });
  const tabCount = await execute<number>(
    session,
    "return document.querySelectorAll('.tab-label').length",
  );
  assert.equal(tabCount, 3, "the handed-over file should open as a new tab in the same window");
});

test("a second instance opens every supported file it is given", { skip }, async () => {
  // What a file manager sends for `Exec=glyph %F` with several files selected,
  // one of them a type Glyph refuses.
  assert.equal(await launchAgain(resolveBinary(), [UNSUPPORTED, DELTA, EPSILON]), 0);

  await waitFor("the last file named to become the active tab", async () => {
    return (await renderedHeading()).trim() === "Epsilon smoke document";
  });
  assert.deepEqual(await openTabs(), ["gamma.md", "alpha.md", "beta.md", "delta.md", "epsilon.md"]);
});

// Node cannot put a byte that is not UTF-8 into argv, so a shell builds the
// argument; that is only portable on Linux, which is also where such file
// names (legacy encodings) actually turn up.
const skipNonUnicode = skip || (process.platform === "linux" ? false : "needs a POSIX shell");

test("a non-Unicode file name does not sink the launch", { skip: skipNonUnicode }, async () => {
  // The single-instance plugin panics on such an argument when it forwards,
  // so Glyph relaunches itself without it first. `\351` is a Latin-1 e-acute.
  const script = 'exec "$0" "$(printf \'caf\\351.md\')" "$1"';
  assert.equal(await launchAgain("sh", ["-c", script, resolveBinary(), ZETA]), 0);

  await waitFor("the file named beside it to open", async () => {
    return (await renderedHeading()).trim() === "Zeta smoke document";
  });
});
