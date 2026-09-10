// Starts a built `glyph mcp` the way an MCP client does, with piped stdin and
// stdout and no terminal, then checks the handshake, the tool list and one
// tool call, and that nothing but JSON-RPC reached stdout.
//
// Usage: node scripts/mcp-smoke.mjs <glyph binary> <vault folder>
import { spawn } from "node:child_process";

const [binary, vault] = process.argv.slice(2);
if (!binary || !vault) {
  console.error("usage: node scripts/mcp-smoke.mjs <glyph binary> <vault folder>");
  process.exit(2);
}

const child = spawn(binary, ["mcp", "--vault", vault], { stdio: ["pipe", "pipe", "inherit"] });
const waiting = new Map();
let pending = "";

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
    waiting.get(message.id)?.(message);
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
  capabilities: {},
  clientInfo: { name: "mcp-smoke", version: "1" },
});
if (init.result?.protocolVersion !== "2025-11-25") fail(`initialize: ${JSON.stringify(init)}`);
send({ method: "notifications/initialized" });

const listed = await request(2, "tools/list", {});
const names = listed.result?.tools?.map((tool) => tool.name) ?? [];
if (!names.includes("vault_report")) fail(`tools/list: ${JSON.stringify(listed)}`);

const called = await request(3, "tools/call", { name: "vault_report", arguments: {} });
const text = called.result?.content?.[0]?.text;
if (called.result?.isError || !text) fail(`tools/call: ${JSON.stringify(called)}`);
const report = JSON.parse(text);

child.stdin.end();
const code = await new Promise((resolve) => child.on("close", resolve));
clearTimeout(timer);
if (pending !== "") fail(`stdout ended mid-line: ${pending}`);
if (code !== 0) fail(`exited with ${code}`);
console.log(
  `mcp smoke: ${names.length} tools over ${init.result.protocolVersion}, ` +
    `${report.unresolved.total} unresolved links in ${vault}, clean exit`,
);
