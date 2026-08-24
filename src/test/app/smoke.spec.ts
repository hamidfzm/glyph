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
// checks the three things unit tests cannot see, because they need a real
// process launch under the production CSP: a CLI-arg document renders (cold
// start, commit 5714293 / #494), the editor is laid out on screen and holds
// the document under the production CSP (#390), and a second launch reuses
// the running window (#189, #494). `pnpm test:app`; CI runs it on Linux under
// xvfb (see .github/actions/app-smoke). Needs a release binary: the
// single-instance plugin is release-only (lib.rs), so a --debug build cannot
// exercise the second-instance case.

// macOS has no WebKit WebDriver, so tauri-driver cannot drive it there.
const skip = process.platform === "darwin" ? "no WebKit WebDriver on macOS" : false;

const ALPHA = fileURLToPath(new URL("./fixtures/alpha.md", import.meta.url));
const BETA = fileURLToPath(new URL("./fixtures/beta.md", import.meta.url));

let driver: ChildProcess;
let session: string;

const renderedHeading = () =>
  execute<string>(session, "return document.querySelector('.markdown-body h1')?.textContent ?? ''");

before(
  async () => {
    if (skip) return;
    driver = await startDriver();
    session = await newSession(resolveBinary(), [ALPHA]);
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

test("renders the markdown file passed as a CLI argument", { skip }, async () => {
  await waitFor("the alpha heading to render", async () => {
    return (await renderedHeading()).trim() === "Alpha smoke document";
  });
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
  // The single-instance plugin makes this process hand BETA to the running
  // app and exit; if it instead opened its own window, this session (attached
  // to the first window) would keep showing ALPHA with a single tab.
  const second = spawn(resolveBinary(), [BETA], { stdio: "ignore", env: APP_ENV });
  const code = await new Promise<number | null>((resolve, reject) => {
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
  assert.equal(code, 0);

  await waitFor("the beta heading to render in the same window", async () => {
    return (await renderedHeading()).trim() === "Beta smoke document";
  });
  const tabCount = await execute<number>(
    session,
    "return document.querySelectorAll('.tab-label').length",
  );
  assert.equal(tabCount, 2, "the handed-over file should open as a second tab in the same window");
});
