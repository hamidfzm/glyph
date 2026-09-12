// Starts a built `glyph mcp` the way an MCP client does, with piped stdin and
// stdout, no terminal and no --vault, then checks the handshake, the tool
// list, a report on the vault, a folder the server has to ask the user for,
// and that nothing but JSON-RPC reached stdout.
//
// Usage: node scripts/mcp-smoke.mjs <glyph binary> <vault folder>
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const [binary, vault] = process.argv.slice(2);
if (!binary || !vault) {
  console.error("usage: node scripts/mcp-smoke.mjs <glyph binary> <vault folder>");
  process.exit(2);
}

const child = spawn(binary, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
const waiting = new Map();
const questions = [];
let pending = "";

// A server that dies with a request pending is reported by its exit code, not
// by the timer.
child.on("error", (err) => fail(`could not start ${binary}: ${err.message}`));
child.on("exit", (code, signal) => {
  if (waiting.size > 0) fail(`exited with ${code ?? signal} while a request was pending`);
});
child.stdin.on("error", (err) => fail(`the server closed its stdin: ${err.message}`));

function fail(reason) {
  console.error(`mcp smoke: ${reason}`);
  child.kill();
  process.exit(1);
}

const timer = setTimeout(() => fail("no reply within 60 s"), 60_000);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  pending += chunk;
  for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
    const line = pending.slice(0, end);
    pending = pending.slice(end + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(`stdout carried a line that is not JSON: ${line}`);
    }
    if (message.jsonrpc !== "2.0") fail(`stdout carried a non-JSON-RPC message: ${line}`);
    if (message.method === "elicitation/create") {
      questions.push(message.params.message);
      send({ id: message.id, result: { action: "accept" } });
    } else {
      const resolve = waiting.get(message.id);
      if (resolve) {
        waiting.delete(message.id);
        resolve(message);
      }
    }
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function request(id, method, params) {
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    send({ id, method, params });
  });
}

const init = await request(1, "initialize", {
  protocolVersion: "2025-11-25",
  capabilities: { elicitation: {} },
  clientInfo: { name: "mcp-smoke", version: "1" },
});
if (init.result?.protocolVersion !== "2025-11-25") fail(`initialize: ${JSON.stringify(init)}`);
send({ method: "notifications/initialized" });

const listed = await request(2, "tools/list", {});
const names = listed.result?.tools?.map((tool) => tool.name) ?? [];
if (!names.includes("vault_report")) fail(`tools/list: ${JSON.stringify(listed)}`);

// The vault is served once allowed, unless the app here already has it open.
const called = await request(3, "tools/call", {
  name: "vault_report",
  arguments: { vault: resolve(vault) },
});
const text = called.result?.content?.[0]?.text;
if (called.result?.isError || !text) fail(`tools/call: ${JSON.stringify(called)}`);
const report = JSON.parse(text);

// A folder no app has open: the server must ask, then read it once allowed.
const extra = mkdtempSync(join(tmpdir(), "glyph-mcp-smoke-"));
writeFileSync(join(extra, "Note.md"), "[[Nowhere]]\n");
const asked = await request(4, "tools/call", { name: "vault_report", arguments: { vault: extra } });
rmSync(extra, { recursive: true, force: true });
const extraText = asked.result?.content?.[0]?.text;
const askedAboutExtra = questions.filter((question) => question.includes(basename(extra)));
if (asked.result?.isError || !extraText || askedAboutExtra.length !== 1) {
  fail(`asking for a folder: ${JSON.stringify(asked)}, questions: ${JSON.stringify(questions)}`);
}
if (JSON.parse(extraText).unresolved.total !== 1) fail(`the allowed folder: ${extraText}`);

child.stdin.end();
const code = await new Promise((resolve) => child.on("close", resolve));
clearTimeout(timer);
if (pending !== "") fail(`stdout ended mid-line: ${pending}`);
if (code !== 0) fail(`exited with ${code}`);
console.log(
  `mcp smoke: ${names.length} tools over ${init.result.protocolVersion}, ` +
    `${report.unresolved.total} unresolved links in ${vault}, ` +
    `${questions.length} folders allowed on request, clean exit`,
);
